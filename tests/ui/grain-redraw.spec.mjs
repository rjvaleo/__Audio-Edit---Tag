// The grain layer must follow the view, and must never show the wrong data.
//
// Written after "the granular engine redraw over the waveform is really sketchy
// — it drops redraws, it loses its brain state". Three separate faults were
// reproduced, and all three came from the same place: the picture's state was
// updated by whatever finished last, and redrawn only when something happened
// to remember to ask.
//
//   1. Two `loadGrains` in flight and the *older* one lands last, so the state
//      describes a window nobody is looking at.
//   2. Switch sounds mid-request and the previous file's grains are drawn on the
//      new file's waveform.
//   3. Zoom or scroll and the marks stay at their old pixel positions, because
//      the redraw only happened when a *fetch* was needed.
//
// Each test below is one of those, driven the way it actually happens.

import { test, expect } from '@playwright/test';

async function editing(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0,
    { timeout: 20_000 });
  // A schedule worth drawing.
  await page.evaluate(async () => {
    document.querySelector('#stretchEngine .seg-btn[data-alg="granular"]')?.click();
    await new Promise((r) => setTimeout(r, 300));
    state.grainDraft.densityHz = 120;
    state.grainDraft.layers = 2;
    await editOp({ op: 'stretch', ...state.stretchDraft, grain: state.grainDraft });
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => loadGrains());
  await page.waitForTimeout(1200);
}

/// 1. The newest request wins, however the network reorders them.
test('a slow older request cannot overwrite a newer one', async ({ page }) => {
  await editing(page);

  const out = await page.evaluate(async () => {
    // Make the wide request slow, so the stale one lands last.
    const real = window.fetch;
    window.fetch = async (...a) => {
      const u = String(a[0] || '');
      if (u.includes('/api/grains')) {
        const to = +(u.match(/[?&]to=(\d+)/) || [])[1] || 0;
        const from = +(u.match(/[?&]from=(\d+)/) || [])[1] || 0;
        if (to - from > 5_000_000) await new Promise((r) => setTimeout(r, 800));
      }
      return real.apply(window, a);
    };
    const total = state.view.frames;
    state.view.from = 0; state.view.to = total;
    const wide = loadGrains();
    await new Promise((r) => setTimeout(r, 60));
    state.view.from = Math.round(total * 0.5);
    state.view.to = state.view.from + 200_000;
    const narrow = loadGrains();
    await Promise.all([wide, narrow]);
    await new Promise((r) => setTimeout(r, 200));
    window.fetch = real;
    return { view: [state.view.from, state.view.to], grainsFor };
  });

  expect(out.grainsFor, 'no schedule was kept at all').not.toBeNull();
  const span = out.grainsFor[1] - out.grainsFor[0];
  expect(
    span,
    `the state describes ${span} frames while the view is ${out.view[1] - out.view[0]} — `
    + 'the older, wider request landed last and won',
  ).toBeLessThan(1_000_000);
});

/// 2. Grains belong to a file, and only to that file.
test('switching sounds mid-request never draws the old file’s grains', async ({ page }) => {
  await editing(page);

  const out = await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    const a = state.selectedFile;
    const b = files.find((x) => x.path !== a.path);
    if (!b) return { skipped: true };

    const real = window.fetch;
    window.fetch = async (...x) => {
      if (String(x[0] || '').includes('/api/grains')) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      return real.apply(window, x);
    };
    const inflight = loadGrains();
    await new Promise((r) => setTimeout(r, 80));
    // Through `selectFile`, the way clicking a sound does it — assigning
    // `state.selectedFile` by hand simulates something the interface never
    // does, and tests a path that does not exist.
    await selectFile(b);
    await inflight;
    window.fetch = real;
    // Let anything already scheduled finish, then ask the settled question:
    // does the schedule in hand belong to the sound that is open?
    await new Promise((r) => setTimeout(r, 1200));
    return { selected: state.selectedFile.path, grainsPath, skipped: false };
  });

  if (out.skipped) test.skip(true, 'only one sound in the library');
  expect(
    out.grainsPath === null || out.grainsPath === out.selected,
    `showing grains from ${out.grainsPath} while ${out.selected} is open`,
  ).toBe(true);
});

/// 3. Moving the view re-places the marks, with or without a fetch.
test('scrolling re-draws the grain layer immediately', async ({ page }) => {
  await editing(page);

  const out = await page.evaluate(async () => {
    const l = document.getElementById('grainLayer');
    const sig = () => {
      const d = l.getContext('2d').getImageData(0, 0, l.width, l.height).data;
      let h = 0;
      for (let i = 3; i < d.length; i += 997) h = (h * 31 + d[i]) | 0;
      return h;
    };
    drawGrainLayer();
    const before = sig();
    const span = state.view.to - state.view.from;
    state.view.from += Math.round(span * 0.15);
    state.view.to += Math.round(span * 0.15);
    // Exactly what the scroll handler does — and nothing more. No waiting for a
    // fetch: the question is whether the picture is right *now*.
    loadPeaks();
    grainsFollowView();
    return { before, after: sig(), lit: l.width * l.height > 0 };
  });

  expect(out.lit, 'the canvas has no size, so this proves nothing').toBe(true);
  expect(
    out.after !== out.before,
    'the view moved and the grain layer came back byte-identical — the marks are '
    + 'still drawn at the old positions',
  ).toBe(true);
});

/// And the layer keeps up with a zoom, which changes how many marks there are.
test('zooming in shows the schedule for the zoomed view', async ({ page }) => {
  await editing(page);

  const out = await page.evaluate(async () => {
    const frames = state.view.frames || 0;
    // A tenth of whatever this sound is. The scratch library is two one-second
    // tones, so a fixed "zoom to ten seconds" lands past the end of the file and
    // measures nothing — which is how the first version of this test failed.
    if (frames < 20_000) return { tooShort: true, frames };
    const wideFor = grainsFor ? grainsFor[1] - grainsFor[0] : null;
    state.sel = { start: Math.round(frames * 0.4), end: Math.round(frames * 0.5) };
    fitSelection();
    await new Promise((r) => setTimeout(r, 2500));
    return {
      tooShort: false, wideFor,
      narrowFor: grainsFor ? grainsFor[1] - grainsFor[0] : null,
      view: state.view.to - state.view.from,
    };
  });

  if (out.tooShort) test.skip(true, `the library's sounds are ${out.frames} frames — nothing to zoom into`);
  expect(out.narrowFor, 'no schedule after zooming').not.toBeNull();
  expect(
    out.narrowFor,
    `zoomed to ${out.view} frames but the schedule still covers ${out.narrowFor}`,
  ).toBeLessThan(out.wideFor);
});
