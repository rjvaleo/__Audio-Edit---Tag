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

/// Six engines, each with its own panel of controls. Switching between them
/// rebuilds that panel, which is where a missing helper would throw.
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

/// The feedback engine's two controls only exist on it, and the panel is cached
/// by file *and* engine so that switching to it rebuilds. That cache key was
/// wrong once, and the controls only appeared after opening a different sound.
test('the feedback engine reveals its own controls when chosen', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);

  // Set the precondition rather than assume it. One server holds one document
  // for the whole run, so whatever the previous test left selected is still
  // selected — and this failed first time round because the engine test before
  // it happened to finish on `feedback`.
  const pick = async (alg) => {
    await page.evaluate((a) => {
      document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click();
    }, alg);
    await page.waitForTimeout(600);
  };

  await pick('granular');
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('#extGrain .k')].map((k) => k.textContent.trim()),
  );
  expect(before, 'the grain panel is empty on granular').not.toEqual([]);
  expect(before.join(' '), 'Reach should belong to the sixth engine alone').not.toContain('Reach');

  await pick('feedback');

  const after = await page.evaluate(() =>
    [...document.querySelectorAll('#extGrain .k')].map((k) => k.textContent.trim()),
  );
  expect(after, 'the feedback controls did not appear').toContain('Mix');
  expect(after).toContain('Reach');
});
