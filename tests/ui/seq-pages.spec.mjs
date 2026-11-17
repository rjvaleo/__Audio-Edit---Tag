// The sequencer's pages, as RJ set them on 16 Nov 2026:
//
// - Seq is the scale sequencer as it was built: the synth, the filter, three
//   LFOs, the delay, the scale, the steps, the performance and the 88 keys;
//   nothing of Atmosphere, the Journey or the Band on it;
// - the Band is a page of its own on the rail, the panel as it was;
// - Atmosphere has no file overview, transport line or Atmosphere bar, and the
//   computer's letters play its keys;
// - on Stems, Play is the song alone: the sequencer is not started.

import { test, expect } from './test.mjs';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
}
const frameOf = (page) => page.frames().find((f) => f.url().includes('/sequencer/'));
const shown = (frame, sel) => frame.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), sel);

test('Seq is the sequencer as it was built; the Band is its own page', async ({ page }) => {
  await ready(page);
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const f = frameOf(page);
  for (const s of ['#classicPanel', '.syn-filter', '.synth-lfo', '.fx-delay', '.scale-display', '.seq-panel', '.perf-panel', '.keyboard-panel']) {
    expect(await shown(f, s), `${s} on Seq`).toBe(true);
  }
  for (const s of ['#atGroup', '#spaceHost', '.scope-out', '#journeyHost', '#accompanyHost']) {
    expect(await shown(f, s), `${s} on Seq`).toBe(false);
  }
  await page.locator('#leftRail [data-mode="band"]').click();
  expect(await page.evaluate(() => $('modeLabel').textContent)).toBe('Band');
  await expect.poll(() => shown(f, '#accompanyHost')).toBe(true);
  expect(await shown(f, '.seq-panel')).toBe(false);
  expect(await shown(f, '#playBtn'), 'the Band can be heard from its page').toBe(true);
  // Back to Seq: the Band is gone from it again.
  await page.locator('#leftRail [data-mode="seq"]').click();
  await expect.poll(() => shown(f, '#accompanyHost')).toBe(false);
});

test('Atmosphere starts with its oscillators, and the computer\'s keys play it', async ({ page }) => {
  await ready(page);
  await page.locator('#leftRail [data-mode="atmos"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const f = frameOf(page);
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('only-atmos'))).toBe(true);
  expect(await page.evaluate(() => PO.on || !PO.el.classList.contains('hidden')), 'the file overview shows on Atmosphere').toBe(false);
  for (const s of ['.transport', '.at-bar']) expect(await shown(f, s), `${s} on Atmosphere`).toBe(false);
  // The first thing on the page is oscillator A.
  const top = await f.evaluate(() => {
    const vis = [...document.querySelectorAll('.right-panel .panel')].filter((e) => e.getClientRects().length);
    vis.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return vis[0]?.dataset.osc || vis[0]?.className;
  });
  expect(top).toContain('A');
  expect(await f.evaluate(() => document.querySelectorAll('.ky-key').length)).toBe(61);
  // Seq's Filter and Delay, which it plays through, are shown here too.
  // Its own filter, LFOs, tuning and effects; nothing of Seq's synth.
  for (const s of ['.at-filt', '.at-lfo', '.at-tune', '#atFxLine', '.scope-out']) expect(await shown(f, s), `${s} on Atmosphere`).toBe(true);
  for (const s of ['#classicPanel', '.syn-filter', '.lfo-unit', '.fx-delay', '.fx-space']) expect(await shown(f, s), `${s} on Atmosphere`).toBe(false);
  // One line: Character, Sympathy and its Filter share a top.
  const tops = await f.evaluate(() => ['.at-char', '.at-sym', '.at-filt'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await f.locator('body').click({ position: { x: 5, y: 5 } });
  await f.evaluate(() => document.body.focus());
  await page.keyboard.down('a');
  expect(await f.evaluate(() => [...KY.held.keys()])).toHaveLength(1);
  await page.keyboard.up('a');
  expect(await f.evaluate(() => [...KY.held.keys()])).toHaveLength(0);
});

test('on Stems, Play is the song alone: the sequencer is not started', async ({ page }) => {
  await ready(page);
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  const f = frameOf(page);
  await page.locator('#leftRail [data-mode="stems"]').click();
  await page.evaluate(() => seqSync(true));
  await page.waitForTimeout(300);
  expect(await f.evaluate(() => isPlaying), 'Stems started the sequencer').toBe(false);
  // On Seq the same call plays it.
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.evaluate(() => seqSync(true));
  await page.waitForTimeout(300);
  expect(await f.evaluate(() => isPlaying)).toBe(true);
  await page.evaluate(() => seqSync(false));
});
