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

/// **A page's answer that comes back after all.** Three times on GitHub's
/// runner (20 and 21 Nov) a test's opening `page.evaluate` — read the folder,
/// `selectFile`, `setMode` — failed with "Resulting promise was garbage
/// collected": in each trace every request of the work had come back and the
/// last of them had gone out under a millisecond before, so the page had done
/// it all and only the browser's hold on the answer was lost. Not seen on the
/// MacBook, even with the browser collecting every 3,000 allocations.
///
/// So a function is run in the page with its promise held there, and its
/// outcome kept as it settles. When the browser loses the answer, it is read
/// back from the page; a promise that never settles still fails the test, at
/// its timeout. Everything else — a string to evaluate, what is passed, what
/// comes back, what is thrown — is as `page.evaluate` does it.
function keepAnswers(page) {
  const evaluate = page.evaluate.bind(page);
  let runs = 0;
  page.evaluate = async (fn, arg) => {
    // A method written short (`f() {}`) is not an expression on its own.
    if (typeof fn !== 'function' || !/^(async\b|function\b|\(|[\w$]+\s*=>)/.test(fn.toString())) return evaluate(fn, arg);
    const id = ++runs;
    try {
      return await evaluate(([src, a, id]) => {
        const held = (window.__pwHeld ||= new Map());
        const done = (window.__pwDone ||= new Map());
        // An outcome nobody came back for is dropped after ten seconds.
        for (const [k, d] of done) if (performance.now() - d.at > 10_000) done.delete(k);
        const p = Promise.resolve().then(() => (0, eval)(`(${src})`)(a));
        held.set(id, p);
        const at = () => performance.now();
        p.then((v) => done.set(id, { v, at: at() }), (e) => done.set(id, { e, at: at() }))
          .finally(() => held.delete(id));
        return p;
      }, [fn.toString(), arg, id]);
    } catch (e) {
      if (!/garbage collected/.test(String(e?.message))) throw e;
      await page.waitForFunction((id) => window.__pwDone?.has(id), id, { timeout: 0 });
      return evaluate((id) => {
        const d = window.__pwDone.get(id);
        window.__pwDone.delete(id);
        if ('e' in d) throw d.e;
        return d.v;
      }, id);
    }
  };
}

export const test = !MAP ? base.extend({
  page: async ({ page }, use) => {
    keepAnswers(page);
    await use(page);
  },
}) : base.extend({
  page: async ({ page }, use, info) => {
    keepAnswers(page);
    // The server routes the test reached, from any page in its context: a
    // change to one route's handler then reruns only the specs that call it.
    const routes = new Set();
    page.context().on('request', (r) => {
      try {
        const u = new URL(r.url());
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') routes.add(u.pathname);
      } catch { /* not a URL */ }
    });
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
    if (!ready) {
      appendFileSync(MAP, JSON.stringify({ spec: info.file.replace(/.*tests\/ui\//, ''), ran: {}, routes: [...routes] }) + '\n');
      return;
    }
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
    appendFileSync(MAP, JSON.stringify({ spec: info.file.replace(/.*tests\/ui\//, ''), ran, routes: [...routes] }) + '\n');
  },
});
