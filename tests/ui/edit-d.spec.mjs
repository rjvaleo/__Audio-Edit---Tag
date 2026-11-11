// The Edit page's new face (D, 10 Nov 2026) and the Now Playing bar. See
// `docs/EDIT-PAGE.md`.
//
// - The transport is one bar across the top of every page, in the same place.
// - On the Edit page: command tabs whose knobs answer the old dialogs; fades
//   and level dragged on the selection, each sending one edit and keeping the
//   selection and the view; edges that can be picked up; a pie on right-click;
//   ⌘K for every command; counters under the wave.

import { test, expect } from './test.mjs';

async function openEdit(page) {
  await page.addInitScript(() => {
    try { for (const k of ['editPage', 'editToolbar', 'editTab', 'editShow', 'editParams']) localStorage.removeItem(k); } catch {}
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async () => {
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(files.find((f) => /tone\.wav$/.test(f.path)) || files[0]);
    setMode('edit');
    setSnap('off');
  });
  await page.waitForFunction(() => !!state.edit, { timeout: 20_000 });
  await page.click('#leftRail .rl-item[data-page="wave"]');
  await page.waitForFunction(() => document.body.classList.contains('wavepage') && !!state.peaks);
  await page.evaluate(() => editOp({ op: 'revert' }));
  await page.waitForFunction(() => !!edSound.mono, { timeout: 20_000 });
}
const select = (page, start, end) => page.evaluate(([a, b]) => { state.sel = { start: a, end: b }; drawSelection(); }, [start, end]);
const edits = (page) => {
  const ops = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/edit')) ops.push(JSON.parse(r.postData())); });
  return ops;
};

test('the Now Playing bar is on every page, with play in the one place', async ({ page }) => {
  await openEdit(page);
  const at = {};
  for (const [mode, sub] of [['edit', 'wave'], ['edit', 'grain'], ['edit', 'chop'], ['synth'], ['room'], ['seq'], ['overview']]) {
    await page.click(`#leftRail .rl-item[data-mode="${mode}"]` + (sub ? `[data-page="${sub}"]` : ''));
    await page.waitForTimeout(300);
    at[sub || mode] = await page.evaluate(() => {
      const r = document.getElementById('playBtn').getBoundingClientRect();
      return { bar: !!document.getElementById('playBtn').closest('#nowBar'), x: Math.round(r.x), y: Math.round(r.y), shown: r.width > 0 };
    });
  }
  const first = Object.values(at)[0];
  for (const [k, v] of Object.entries(at)) expect(v, k).toEqual(first);
  expect(first.bar && first.shown).toBe(true);
});

test('a knob answers the dialog: Gain runs at the knob\'s value and asks nothing', async ({ page }) => {
  await openEdit(page);
  const ops = edits(page);
  await select(page, 2000, 12000);
  await page.evaluate(() => { edParams.gainDb = -6; edSetTab('Process'); });
  await page.click('#waveTools [data-cmd="gain"]');
  await expect.poll(() => ops.filter((o) => o.op === 'gain').map((o) => o.db)).toEqual([-6]);
  expect(await page.isVisible('#askModal')).toBe(false);
  // The menus still ask.
  expect(await page.evaluate(() => askAnswer)).toBe(null);
});

test('the fade handle sends one fade of the dragged length, and the selection and the view stay', async ({ page }) => {
  await openEdit(page);
  const ops = edits(page);
  await page.evaluate(() => { state.view.from = 0; state.view.to = Math.round(state.view.frames / 2); loadPeaks(); });
  await page.waitForTimeout(300);
  await select(page, 2000, 18000);
  const h = await page.locator('.ed-fh[data-h="fi"]').boundingBox();
  const want = await page.evaluate(() => Math.round(80 * (state.view.to - state.view.from) / $('lane').clientWidth));
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 80, h.y + h.height / 2, { steps: 6 });
  // While held, the result is drawn over the selection.
  expect(await page.isVisible('#edPreview')).toBe(true);
  await page.mouse.up();
  await expect.poll(() => ops.filter((o) => o.op === 'fadeIn').length).toBe(1);
  const op = ops.find((o) => o.op === 'fadeIn');
  expect(op.start).toBe(2000);
  expect(op.end).toBe(18000);
  expect(Math.abs(op.frames - want)).toBeLessThan(want * 0.05 + 50);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ sel: state.sel, half: state.view.to < state.view.frames * 0.6 }));
  expect(after.sel).toEqual({ start: 2000, end: 18000 });
  expect(after.half).toBe(true);
});

test('the level pill sends one gain, by how far it was dragged', async ({ page }) => {
  await openEdit(page);
  const ops = edits(page);
  await select(page, 4000, 30000);
  const g = await page.locator('.ed-gg').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => ops.filter((o) => o.op === 'gain').length).toBe(1);
  const op = ops.find((o) => o.op === 'gain');
  expect(op.db).toBeLessThan(0);
  expect([op.start, op.end]).toEqual([4000, 30000]);
});

test('an edge of the selection is picked up and moved, not replaced', async ({ page }) => {
  await openEdit(page);
  await select(page, 8000, 20000);
  const x = await page.evaluate(() => { const r = $('lane').getBoundingClientRect(); return r.left + framesToX(state.sel.end) * r.width; });
  const box = await page.locator('#lane').boundingBox();
  await page.mouse.move(x, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(x + 50, box.y + box.height / 3, { steps: 5 });
  expect(await page.isVisible('#edLoupe')).toBe(true);
  await page.mouse.up();
  const sel = await page.evaluate(() => state.sel);
  expect(sel.start).toBe(8000);
  expect(sel.end).toBeGreaterThan(20000);
  expect(await page.isVisible('#edLoupe')).toBe(false);
});

test('right-click on the wave opens the pie, and the pie runs its command', async ({ page }) => {
  await openEdit(page);
  const ops = edits(page);
  await select(page, 1000, 9000);
  const box = await page.locator('#lane').boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2, { button: 'right' });
  // The pie itself is a point with its buttons round it, so its buttons are what show.
  await expect(page.locator('#edPie .ed-w').first()).toBeVisible();
  expect(await page.locator('#edPie .ed-w').count()).toBe(8);
  expect(await page.isVisible('#menuPop')).toBe(false);
  await page.click('#edPie [data-cmd="reverse"]');
  await expect.poll(() => ops.map((o) => o.op)).toContain('reverse');
  await expect(page.locator('#edPie .ed-w').first()).toBeHidden();
});

test('⌘K finds a command by name and runs it; Escape closes it', async ({ page }) => {
  await openEdit(page);
  const ops = edits(page);
  await select(page, 1000, 9000);
  await page.keyboard.press('Meta+k');
  await expect(page.locator('#edK')).toBeVisible();
  await page.keyboard.type('reverse');
  expect(await page.locator('#edKList .ed-kr').count()).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => ops.map((o) => o.op)).toContain('reverse');
  await expect(page.locator('#edK')).toBeHidden();
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Escape');
  await expect(page.locator('#edK')).toBeHidden();
});

test('the counters say where the selection is, and the rulers are drawn', async ({ page }) => {
  await openEdit(page);
  await select(page, 4410, 8820);
  const got = await page.evaluate(() => {
    const c = (k) => document.querySelector(`#edCounters [data-c="${k}"] b`).textContent;
    return { start: c('start'), length: c('length'), time: $('edTimeCanvas').width > 0, level: $('edLevelCanvas').width > 0 };
  });
  const sr = await page.evaluate(() => state.view.sampleRate);
  expect(got.length).toBe(`${(4410 / sr).toFixed(3)} s`);
  expect(got.time && got.level).toBe(true);
});

test('the Look is one setting for the whole app, set from the bar', async ({ page }) => {
  await openEdit(page);
  await page.click('#nbLook button[data-s="C"]');
  expect(await page.evaluate(() => [document.documentElement.dataset.mglLook, localStorage.getItem('mglLook')])).toEqual(['C', 'C']);
  await page.click('#nbLook button[data-s="AD"]');
});
