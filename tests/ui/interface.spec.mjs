// Does the interface actually work?
//
// Every check here is one that reading the source cannot answer, and each is
// modelled on something that really went wrong:
//
// - A panel threw while it built, and the whole right-hand side went blank. The
//   file parsed; `node --check` was happy; nothing said a word until the screen
//   was empty.
// - A control looked identical to the ones beside it and did nothing on
//   double-click, because it had been handed a default that did not exist.
// - A module was added to the picker on nothing but my own say-so, with no test
//   saying it could be built.
//
// So: watch the console, open things, and assert on the DOM rather than on the
// source that produced it.

import { test, expect } from '@playwright/test';

/// Every console error and page exception, in the order they happened.
///
/// Attached before the first navigation, because the ones that matter fire
/// while the page is still starting up.
function watchErrors(page) {
  const seen = [];
  page.on('console', (m) => {
    if (m.type() === 'error') seen.push(m.text());
  });
  page.on('pageerror', (e) => seen.push(`uncaught: ${e.message}`));
  return seen;
}

/// The app fetches its library, its rack and its shapers after load. Waiting on
/// a fixed timeout would be flaky; waiting on the tree having rows is what
/// "ready" actually means.
async function ready(page) {
  await page.goto('/');
  // Bare `state`, not `window.state`. It is declared with `const` at the top
  // level of a classic script, which makes it a lexical global and *not* a
  // property of `window` — so `window.state` is forever undefined and a wait on
  // it never resolves. Cost five timed-out tests to learn.
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, {
    timeout: 15_000,
  });
}

/// Open the first sound in the library, and wait for the panels it builds.
async function openFirstSound(page) {
  await page.evaluate(async () => {
    // `state.folders` holds *folders*, not files — a folder has a name and a
    // count, and handing one to `selectFile` gets as far as reading its sample
    // rate before it gives up. The files live behind their own route.
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, {
    timeout: 15_000,
  });
}

test('the page loads without a single console error', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  expect(errors, 'the interface reported errors while loading').toEqual([]);
});

test('opening a sound builds every panel without throwing', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await openFirstSound(page);

  const built = await page.evaluate(() => ({
    file: state.selectedFile?.path || null,
    grainRows: Object.keys(state.grainRows || {}).length,
    stretchRows: Object.keys(state.stretchRows || {}).length,
  }));

  expect(built.file, 'no sound was opened').not.toBeNull();
  expect(built.grainRows, 'the grain panel is empty').toBeGreaterThan(0);
  expect(built.stretchRows, 'the stretch panel is empty').toBeGreaterThan(0);
  expect(errors, 'building the panels reported errors').toEqual([]);
});

/// The one that was asked for, and the one static analysis cannot answer:
/// double-click has to *move the control*, not merely have a handler attached.
test('double-clicking any control returns it to its default', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await openFirstSound(page);

  const report = await page.evaluate(() => {
    const rows = document.querySelectorAll('.param');
    const checked = [];
    for (const row of rows) {
      const input = row.querySelector('input[type=range]');
      const name = row.querySelector('.k')?.textContent?.trim() || '(unnamed)';
      // A control with no default has no handler, deliberately — `param`
      // refuses to invent one. Those are reported by tools/ui-check.mjs; here
      // we only test the ones that claim to reset.
      if (!input || !/double-click to reset/.test(row.title || '')) continue;

      const started = input.value;
      // Move it somewhere it certainly was not.
      const min = Number(input.min);
      const max = Number(input.max);
      const moved = String(Number(input.value) > (min + max) / 2 ? min : max);
      input.value = moved;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const before = input.value;
      input.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const after = input.value;

      checked.push({ name, started, before, after, reset: after !== before });
    }
    return checked;
  });

  // How many this reaches is bounded by what is on screen when it runs — the
  // panels for engines that are not selected are not in the DOM at all. So this
  // is a floor rather than full coverage, and `tools/ui-check.mjs` is what says
  // *every* control has a default. This says the ones you can see actually move.
  test.info().annotations.push({ type: 'controls checked', description: String(report.length) });
  expect(report.length, 'no resettable controls were found to test').toBeGreaterThan(8);
  const dead = report.filter((r) => !r.reset);
  expect(
    dead,
    `these say they reset and did not: ${dead.map((d) => d.name).join(', ')}`,
  ).toEqual([]);
  expect(errors).toEqual([]);
});

/// The spectrogram has to use its height.
///
/// It drew correctly for months and still looked broken, because the frequency
/// axis was linear: an FFT's bins are evenly spaced in hertz, so on a 44.1 kHz
/// file everything musical was crushed into the bottom 3% and the other 97% was
/// exactly zero. Nothing in the source was wrong — the canvas was painted, the
/// geometry was right, and every static check passed. Only looking at it found
/// it, and only after the strip was made taller and the emptiness got bigger.
///
/// So this measures what a person would notice: how much of the height carries
/// anything at all.
/// **Where** the content sits, not how many rows have something in them.
///
/// Two earlier versions of this test passed with the axis forced back to linear,
/// and both failures are worth keeping in mind:
///
/// - Counting lit rows on a sine: one partial is one row on either axis.
/// - Counting lit rows on a *sweep*: a sweep visits every frequency, so it
///   lights every row on either axis. Only the shape of the curve differs.
///
/// What actually distinguishes them is height. The scratch fixture is a 234 Hz
/// sine, which on a linear axis to 22 kHz sits **1.1%** up the picture and on a
/// log axis from 30 Hz sits **31%** up. That is the measurement, and it is the
/// same one the real fault was found by: a file whose energy stopped at 600 Hz
/// filled 3% of the height and looked broken.
test('the spectrogram puts its content up the picture, not in a hairline at the bottom', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await openFirstSound(page);
  await page.evaluate(() => setMode('edit'));
  await page.waitForFunction(() => state.showSpec && !!state.spec, { timeout: 20_000 });
  await page.waitForTimeout(600);

  const report = await page.evaluate(() => {
    const c = document.getElementById('specCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let best = 0;
    let bestRow = 0;
    for (let y = 0; y < c.height; y++) {
      let peak = 0;
      for (let x = 0; x < c.width; x += 3) {
        const i = (y * c.width + x) * 4;
        const v = Math.max(d[i], d[i + 1], d[i + 2]);
        if (v > peak) peak = v;
      }
      if (peak > best) { best = peak; bestRow = y; }
    }
    // Row 0 is the top of the canvas and the high end, so height above the
    // bottom is the complement.
    return { rows: c.height, bestRow, up: (c.height - 1 - bestRow) / (c.height - 1), best };
  });

  test.info().annotations.push({
    type: 'brightest row',
    description: `${(report.up * 100).toFixed(1)}% up the picture`,
  });
  expect(report.best, 'the spectrogram drew nothing at all').toBeGreaterThan(32);
  // Linear puts this fixture at 1.1% and log at 31%. Ten per cent is clear of
  // both the linear case and any reasonable change to the floor frequency.
  expect(
    report.up,
    `the brightest content is only ${(report.up * 100).toFixed(1)}% up the picture — `
    + 'the frequency axis has gone back to linear',
  ).toBeGreaterThan(0.1);
  expect(errors).toEqual([]);
});

/// Five engines, each with its own panel of controls. Switching between them
/// rebuilds that panel, which is where a missing helper would throw.
///
/// Deliberately reads the picker rather than naming the five: a sixth was added
/// and removed inside one day, and a hard-coded list would have been wrong twice.
test('every engine can be selected and builds its own controls', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await openFirstSound(page);

  const engines = await page.evaluate(() =>
    [...document.querySelectorAll('#stretchEngine .seg-btn')].map((b) => b.dataset.alg),
  );
  expect(engines.length, 'the engine picker is empty').toBeGreaterThan(1);

  for (const alg of engines) {
    await page.evaluate((a) => {
      document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click();
    }, alg);
    await page.waitForTimeout(250);
    const chosen = await page.evaluate(() => state.stretchDraft?.algorithm);
    expect(chosen, `selecting ${alg} did not take`).toBe(alg);
  }

  expect(errors, `switching engines reported errors`).toEqual([]);
});

