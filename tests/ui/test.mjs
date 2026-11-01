// Playwright's `test`, with the one thing every spec here shares: when the map
// is being made (`npm run test:map`), the record of which interface code each
// test ran. See `tools/test-changed.mjs`.
//
// Code that runs while the page loads runs for every test, so it says nothing
// about what a test is for. The record is of what ran *after* the page was
// ready: the counts are reset once the page is ready, and only a function that
// ran after that is counted.

import { test as base, expect } from '@playwright/test';
import { appendFileSync } from 'node:fs';

export { expect };

const MAP = process.env.TEST_MAP_OUT;

export const test = MAP ? base.extend({
  page: async ({ page }, use, info) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    let ready = null;
    // The first reading is taken inside `goto`, after the interface has loaded
    // and before the test gets the page back, so nothing the test does is lost
    // to it. Later loads (a reload) are simply counted: more, never less.
    const goto = page.goto.bind(page);
    page.goto = async (...args) => {
      const r = await goto(...args);
      if (!ready) {
        try {
          await page.waitForFunction(() => typeof state !== 'undefined', null, { timeout: 10_000 });
        } catch { /* not the interface; counted from here anyway */ }
        ready = (await cdp.send('Profiler.takePreciseCoverage')).result;
      }
      return r;
    };
    await use(page);
    if (!ready) return;
    const after = (await cdp.send('Profiler.takePreciseCoverage')).result;
    // `takePreciseCoverage` resets the counts, so `after` is only what ran
    // since `ready`. A script's functions that ran at all are what the test
    // touched; the offsets say where in the script, start and end.
    const ran = {};
    for (const s of after) {
      const url = s.url.replace(/^https?:\/\/[^/]+/, '');
      if (!url || !url.endsWith('.js')) continue;
      const offs = s.functions
        .filter((f) => f.ranges[0].count > 0 && f.ranges[0].startOffset > 0)
        .map((f) => [f.ranges[0].startOffset, f.ranges[0].endOffset]);
      if (offs.length) ran[url] = offs;
    }
    appendFileSync(MAP, JSON.stringify({ spec: info.file.replace(/.*tests\/ui\//, ''), ran }) + '\n');
  },
}) : base;
