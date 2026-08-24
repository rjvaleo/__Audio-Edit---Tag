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
    // **The menu is a saved preference, so it outlives a test.** Hiding and
    // reordering in one test left the next one looking at a menu somebody else
    // had arranged — which is a real fault in the test, not in the menu, and it
    // reads as the picker and the registry disagreeing.
    localStorage.removeItem('audiolab.vismenu.v1');
    if (typeof visMenuState !== 'undefined') visMenuState = null;
    buildVisModulePicker();
  });
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
    labelDupes: VIS_ALL.map((v) => v.label).filter((l, i, a) => a.indexOf(l) !== i),
    orphans: VIS_ALL.filter((v) => !VIS_FAMILIES.some((f) => f.key === v.family)).map((v) => v.key),
  }));

  expect(got.dupes, 'a visual is listed twice').toEqual([]);
  // **No two visuals may share a label.** Two entries called "Mandala" — the p5
  // original and the stage's arrangement of the same name — is an offer to pick
  // the worse one by accident, and that is exactly what happened. A key being
  // unique is not enough; the name on the picker is what is actually chosen from.
  expect(got.labelDupes, 'two visuals share a name in the picker').toEqual([]);
  expect(got.orphans, 'a visual is in a family that does not exist').toEqual([]);
  expect(got.families).toEqual(['bus', 'grain', 'arrangement']);
  // Four on the bus, eleven grain views, ten stage arrangements. The count is
  // written down so that adding one without adding it to the picker is a
  // failure and not a surprise.
  expect(got.all.length).toBe(25);

  // **Nothing was replaced.** The ten arrangements sit beside the ten grain
  // views rather than over them: same shapes, different engine, different scene,
  // different decisions, and they look it. Listing them under the grain family
  // gave their names to something else and quietly retired ten pieces of work.
  expect(got.engines.p5, 'the original grain views were removed').toBe(10);
  expect(got.engines.webgl1, 'the original room was removed').toBe(1);
  expect(got.engines.canvas2d, 'the flat stack or the flat swarm was removed').toBe(2);

  // **The state of the port, as a number.** When a phase of the plan lands this
  // changes, and it changing without the plan changing is worth being told.
  const total = Object.values(got.engines).reduce((a, b) => a + b, 0);
  expect(total).toBe(25);
  // Twelve on the new engine: the surfaces, the stage, and the ten arrangements.
  expect(got.engines.babylon).toBe(12);
});

test('the picker offers all of them, grouped', async ({ page }) => {
  await open(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(600);
  const got = await page.evaluate(() => {
    const sel = document.getElementById('rgVisual');
    const bar = document.getElementById('roomStageBar');
    return {
      options: [...sel.options].map((o) => o.value),
      groups: [...sel.querySelectorAll('optgroup')].map((g) => g.label),
      all: VIS_ALL.map((v) => v.key),
      // **It has to fit the bar it lives on.** A row of buttons did not: the
      // family headings were full width, everything after them wrapped, and the
      // picker looked empty with the list perfectly intact behind it.
      fitsBar: bar ? sel.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 1 : null,
      onScreen: sel.getBoundingClientRect().width > 40,
    };
  });
  // **Everything, until somebody says otherwise.** The menu is editable — see
  // `visMenu` — and what it offers is the registry's list minus whatever has
  // been hidden, in whatever order it has been put in. Untouched, that is the
  // registry's own list in the registry's own order, which is what a fresh
  // session has to show.
  expect(got.options, 'the picker and the list disagree').toEqual(got.all);
  expect(got.groups, 'the families are not labelled')
    .toEqual(['Master bus', 'Grains', 'Stage arrangements']);
  expect(got.onScreen, 'the picker is not visible').toBe(true);
  expect(got.fitsBar, 'the picker overflows the bar it sits on').toBe(true);
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
      // An arrangement is the stage, whichever family it is filed under: the ten
      // grain views are the same scene with its cloud laid out differently, so
      // they show up on the bus's host and not the iframe's.
      const want = (v.family === 'bus' || visIsStage(v)) ? 'masterBus' : 'grainVis';
      const host = document.getElementById(want);
      const box = host.getBoundingClientRect();
      return {
        key: v.key,
        onStage: host.parentElement.id === 'roomStageRoom',
        big: box.width > 50 && box.height > 50,
        active: document.getElementById('rgVisual').value,
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

test('the menu can be reordered and thinned, and nothing is lost by it', async ({ page }) => {
  await open(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(600);

  const got = await page.evaluate(async () => {
    const opts = () => [...document.getElementById('rgVisual').options].map((o) => o.value);
    const before = opts();
    toggleVisMenuAdmin(true);
    const host = document.getElementById('visMenuAdmin');
    const rows = host.querySelectorAll('.vma-row').length;

    // Hide two.
    host.querySelectorAll('.vma-eye')[1].click();
    host.querySelectorAll('.vma-eye')[2].click();
    const thinned = opts();

    // **Within its family**, because that is what the menu can show. Take the
    // last of the grain views to the top of the grain views, one press at a
    // time.
    const grains = () => visMenu().order.filter((k) => visEntry(k).family === 'grain');
    const key = grains()[grains().length - 1];
    for (let n = 0; n < 20; n++) {
      if (grains()[0] === key) break;
      const host2 = document.getElementById('visMenuAdmin');
      const row = [...host2.querySelectorAll('.vma-row')]
        .find((r) => r.querySelector('.vma-name').textContent === visEntry(key).label);
      row.querySelectorAll('.vma-move')[0].click();
    }
    const moved = opts();

    // What is on the stage stays reachable even when it is hidden.
    setVisual('ridge');
    const withHiddenShowing = opts();

    // Read what was saved *before* putting it all back, or the check is of the
    // restore rather than of the saving.
    const stored = JSON.parse(localStorage.getItem('audiolab.vismenu.v1'));

    // And nothing was removed: the registry is untouched, and Show all and
    // Default order put both halves of the choice back.
    const btns = document.getElementById('visMenuAdmin').querySelectorAll('.vma-head .re-btn');
    btns[0].click();
    btns[1].click();
    const restored = opts();
    const firstGrain = moved.find((k) => visEntry(k).family === 'grain');
    return { before, rows, thinned, moved, firstGrain, key, stored,
      withHiddenShowing, restored, all: VIS_ALL.map((v) => v.key) };
  });

  // Every visual is offered for editing, whether or not it is in the menu.
  expect(got.rows, 'the admin does not list every visual').toBe(got.all.length);

  // **Hiding takes it out of the menu and nothing else.**
  expect(got.thinned.length).toBe(got.before.length - 2);
  expect(got.all.length, 'hiding a visual removed it from the registry').toBe(got.rows);

  // Reordering is reordering — within the family, which is the only order the
  // menu can express.
  expect(got.firstGrain, 'moving a row to the top of its family did not move it')
    .toBe(got.key);

  // **A hidden visual that is showing stays in the menu**, or the menu says one
  // thing, the stage says another, and there is no way back to what you are
  // looking at.
  expect(got.withHiddenShowing, 'the showing visual fell out of the menu').toContain('ridge');

  // And it is all reversible, both halves of it.
  expect(got.restored, 'the menu did not come back the way it was').toEqual(got.all);
  expect(got.stored.hidden.length, 'the choice was not saved').toBe(2);
});
