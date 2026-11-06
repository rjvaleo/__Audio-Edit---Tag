// The grain tray's bars go two to a line (RJ, 5 Nov 2026: "slice and stride
// should both be ½ width controls not full width"). A bar whose name and
// reading do not both fit side by side at half width puts its reading under
// its name, and stays half; it takes the whole line only when even that would
// cut its name short. See `gcWiden` in `ui/app/190-grain-tray.js`.

import { test, expect } from './test.mjs';

async function openWsola(page, width) {
  await page.setViewportSize({ width, height: 800 });
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
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
  await page.locator('.dock-tab[data-dock="stretch"]').click();
  await page.click('#stretchEngine .seg-btn[data-alg="wsola"]');
  await page.waitForFunction(() => document.querySelector('#grainControls .gk-row[data-glyph="searchMs"]')?.getClientRects().length > 0);
  await page.waitForTimeout(400);
}

/// The Splice section's Search and Stride bars, measured.
function splice() {
  const row = (key) => document.querySelector(`#grainControls .gk-row[data-glyph="${key}"]`);
  const s = row('searchMs'), t = row('stride');
  const body = s.parentElement.getBoundingClientRect();
  const a = s.getBoundingClientRect(), b = t.getBoundingClientRect();
  const cut = (r) => { const k = r.querySelector(':scope > .k'); return k.scrollWidth > k.clientWidth; };
  return {
    body: body.width, search: a.width, stride: b.width,
    sameLine: Math.abs(a.top - b.top) < 2, cut: [cut(s), cut(t)],
  };
}

for (const width of [1600, 1280, 1024]) {
  test(`at ${width} px Search and Stride share a line, half width each, names whole`, async ({ page }) => {
    await openWsola(page, width);
    const got = await page.evaluate(splice);
    expect(got.sameLine, JSON.stringify(got)).toBe(true);
    expect(got.search, JSON.stringify(got)).toBeLessThan(got.body * 0.6);
    expect(got.stride, JSON.stringify(got)).toBeLessThan(got.body * 0.6);
    expect(got.cut, 'a name is cut short').toEqual([false, false]);
  });
}

test('a bar stays half width at any value: dragging Search does not move it', async ({ page }) => {
  await openWsola(page, 1280);
  const widths = await page.evaluate(async () => {
    const row = document.querySelector('#grainControls .gk-row[data-glyph="searchMs"]');
    const input = row.querySelector(':scope > input[type=range]');
    const out = [];
    for (const v of [0, 155.5, 200]) {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(Math.round(row.getBoundingClientRect().width));
    }
    return out;
  });
  expect(new Set(widths).size, `widths ${widths}`).toBe(1);
});
