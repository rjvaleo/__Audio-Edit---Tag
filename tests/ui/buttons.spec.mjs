// Where the buttons are, measured.
//
// This file exists because five hours went into a row of buttons that kept
// coming back wrong, and every time it did I had "verified" it by measuring the
// thing I had just built rather than the thing on screen. The rules below are
// the ones stated during that: one horizontal line, identical size, no overlap,
// no wrapping, and the same positions on every engine.
//
// Nothing here is checked with a tolerance for padding, or "close enough", or a
// snap-to-width. Same line means the same `top` to the pixel. Same size means
// the same `height` to the pixel.

import { test, expect } from '@playwright/test';

const ENGINES = ['wsola', 'vocoder', 'pvsola', 'hybrid', 'granular'];

async function openStretchPanel(page) {
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
  await page.evaluate(() => showPane('right', 'stretch'));
  await page.waitForTimeout(600);
}

async function chooseEngine(page, alg) {
  await page.evaluate((a) => {
    document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click();
  }, alg);
  await page.waitForTimeout(400);
}

/// Every button on the engine row, with the geometry that matters.
const readEngineRow = () => ({
  tabs: [...document.querySelectorAll('#stretchEngine .seg-btn')].map((b) => {
    const r = b.getBoundingClientRect();
    return { t: b.textContent, top: Math.round(r.top), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right) };
  }),
  reset: (() => {
    const b = document.getElementById('stretchReset');
    const r = b.getBoundingClientRect();
    return { t: b.textContent, top: Math.round(r.top), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right) };
  })(),
});

/// Reset is the next button on the row, not a different kind of button near it.
///
/// It was 18px tall against the tabs' 22px and sat on a different line, and it
/// was absolutely positioned so it could land *on top of* "Granular" at widths
/// I was not looking at.
test('Reset sits on the same line as the engine tabs, at the same size', async ({ page }) => {
  await openStretchPanel(page);

  for (const alg of ENGINES) {
    await chooseEngine(page, alg);
    const { tabs, reset } = await page.evaluate(readEngineRow);

    expect(tabs.length, `${alg}: no engine tabs found`).toBe(5);

    // Same horizontal line. To the pixel — not "about".
    for (const tab of tabs) {
      expect(reset.top, `${alg}: Reset top ${reset.top} vs tab "${tab.t}" top ${tab.top}`)
        .toBe(tab.top);
    }
    // Same size.
    for (const tab of tabs) {
      expect(reset.h, `${alg}: Reset height ${reset.h} vs tab "${tab.t}" height ${tab.h}`)
        .toBe(tab.h);
    }
    // And it is called Reset, not RESET.
    expect(reset.t, `${alg}: the reset button reads "${reset.t}"`).toBe('Reset');
  }
});

/// Nothing on that row may sit on top of anything else.
test('nothing on the engine row overlaps anything else', async ({ page }) => {
  await openStretchPanel(page);

  for (const alg of ENGINES) {
    await chooseEngine(page, alg);
    const { tabs, reset } = await page.evaluate(readEngineRow);
    const all = [...tabs, reset].sort((a, b) => a.left - b.left);

    for (let i = 1; i < all.length; i++) {
      expect(
        all[i].left,
        `${alg}: "${all[i].t}" starts at ${all[i].left}, inside "${all[i - 1].t}" `
        + `which ends at ${all[i - 1].right}`,
      ).toBeGreaterThanOrEqual(all[i - 1].right);
    }
  }
});

/// The switches row: one line, identical widths, and the last two places always
/// belong to the tuning and Keys.
test('the switches row is one line of identical buttons on every engine', async ({ page }) => {
  await openStretchPanel(page);

  const seen = {};
  for (const alg of ENGINES) {
    await chooseEngine(page, alg);
    const row = await page.evaluate(() => {
      const box = document.querySelector('.engine-switches');
      return [...box.querySelectorAll('[data-slot]')].map((el) => {
        const b = el.matches('button') ? el : el.querySelector('button');
        const r = b.getBoundingClientRect();
        return { t: b.textContent.trim(), slot: el.dataset.slot,
          top: Math.round(r.top), h: Math.round(r.height),
          left: Math.round(r.left), right: Math.round(r.right),
          w: Math.round(r.width) };
      });
    });

    expect(row.length, `${alg}: no switch buttons found`).toBeGreaterThan(0);

    // One horizontal line.
    const tops = [...new Set(row.map((b) => b.top))];
    expect(tops.length, `${alg}: buttons on ${tops.length} lines — ${JSON.stringify(row.map((b) => `${b.t}@${b.top}`))}`)
      .toBe(1);

    // Identical size — not "roughly", and not a width that depends on how many
    // buttons this engine happens to have.
    const widths = [...new Set(row.map((b) => b.w))];
    expect(widths.length, `${alg}: ${widths.length} different button widths — ${widths}`).toBe(1);
    const heights = [...new Set(row.map((b) => b.h))];
    expect(heights.length, `${alg}: ${heights.length} different button heights — ${heights}`).toBe(1);

    // No overlap.
    const sorted = [...row].sort((a, b) => a.left - b.left);
    for (let i = 1; i < sorted.length; i++) {
      expect(
        sorted[i].left,
        `${alg}: "${sorted[i].t}" overlaps "${sorted[i - 1].t}"`,
      ).toBeGreaterThanOrEqual(sorted[i - 1].right);
    }

    // Keys is the last position on the row, always.
    const rightmost = sorted[sorted.length - 1];
    expect(rightmost.t, `${alg}: the last button on the row is "${rightmost.t}"`).toContain('Keys');
    // And the tuning is the one before it.
    if (sorted.length > 1) {
      expect(sorted[sorted.length - 2].slot, `${alg}: the tuning is not beside Keys`).toBe('3');
    }

    seen[alg] = Object.fromEntries(row.map((b) => [b.slot, b.left]));
  }

  // The tuning and Keys are the two fixed places on the row: they hold the last
  // two positions on every engine, whatever came before them. The engine's own
  // switches flow from the left, so where they land depends on how many that
  // engine has — which is why only slots 3 and 4 are pinned here.
  for (const slot of ['3', '4']) {
    const places = [...new Set(
      Object.values(seen).map((r) => r[slot]).filter((x) => x !== undefined),
    )];
    expect(
      places.length,
      `slot ${slot} sits at ${places} depending on the engine — it must not move`,
    ).toBe(1);
  }

  // And the switches pack from the left with no hole in front of them.
  for (const alg of ENGINES) {
    const lefts = Object.entries(seen[alg])
      .filter(([slot]) => slot !== '3' && slot !== '4')
      .map(([, left]) => left)
      .sort((a, b) => a - b);
    if (!lefts.length) continue;
    const rowLeft = Math.min(...Object.values(seen[alg]));
    expect(lefts[0], `${alg}: the first switch is not at the left of the row`).toBe(rowLeft);
  }
});

/// Stretch, Pitch and Window are the first three sliders under the button row.
///
/// On every engine, and whatever the switches are set to. They used to be
/// appended to the end of the panel, so the engine's own controls came first and
/// the first slider under the buttons was `Re-anchor` on PVSOLA, `Analysis
/// window` on the vocoder and `Tone` on the hybrid.
///
/// Every switch is toggled here rather than trusted, because a switch is exactly
/// what adds a slider — `grain cloud` adds Cloud, `preserve transients` adds
/// Detector — and adding one is what could push the three back down.
test('Stretch, Pitch and Window are the first three sliders on every engine', async ({ page }) => {
  await openStretchPanel(page);

  /// The sliders in the standard column, in the order they appear on screen.
  const sliderOrder = () => page.evaluate(() => {
    const col = document.querySelector('.grain-standard');
    return [...col.querySelectorAll('.param')]
      .filter((r) => r.offsetParent && r.querySelector('input[type=range]'))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((r) => r.querySelector('.k')?.textContent?.trim());
  });

  const failures = [];

  for (const alg of ENGINES) {
    await chooseEngine(page, alg);

    // Every combination of this engine's switches, not just the default one.
    const switchCount = await page.evaluate(
      () => document.querySelectorAll('.engine-switches .tiny.switch').length,
    );
    const combos = 1 << switchCount;

    for (let mask = 0; mask < combos; mask++) {
      // Set each switch to the bit the mask asks for.
      await page.evaluate((m) => {
        const btns = [...document.querySelectorAll('.engine-switches .tiny.switch')];
        btns.forEach((b, i) => {
          const want = !!(m & (1 << i));
          if (b.classList.contains('on') !== want) b.click();
        });
      }, mask);
      await page.waitForTimeout(350);

      const order = await sliderOrder();
      const first3 = order.slice(0, 3);
      const states = await page.evaluate(
        () => [...document.querySelectorAll('.engine-switches .tiny.switch')]
          .map((b) => `${b.textContent.trim()}=${b.classList.contains('on') ? 'on' : 'off'}`),
      );
      if (first3.join('|') !== 'Stretch|Pitch|Window') {
        failures.push(`${alg} [${states.join(', ')}] → ${order.slice(0, 5).join(', ')}`);
      }
    }
    // Leave the switches off so the next engine starts clean.
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.engine-switches .tiny.switch')) {
        if (b.classList.contains('on')) b.click();
      }
    });
    await page.waitForTimeout(300);
  }

  expect(failures, `Stretch/Pitch/Window were not the first three:\n${failures.join('\n')}`)
    .toEqual([]);
});
