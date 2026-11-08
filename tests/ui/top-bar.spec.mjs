// One bar along the top: the workspaces, one transport, and the things that
// open rather than go somewhere. See `docs/TOP-BAR.md`.
//
// The left rail was 168px of the width for six buttons, with 655px of nothing
// under them; the menu bar, the overview strip, the Seq page's own title and
// its own transport stacked 226px of chrome over the first synth knob; and Play
// was on screen twice and Record three times. These hold the replacement to
// what it was for.

import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && typeof state !== 'undefined', { timeout: 20_000 });
}

async function openSeq(page) {
  await boot(page);
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  await page.waitForTimeout(300);
}

const box = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s)?.getBoundingClientRect();
  return r && { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right };
}, sel);

test('there is no column down the left: the workspace starts at the window edge', async ({ page }) => {
  await boot(page);
  // Browse docks its library on the left, and that is Browse's content; every
  // other workspace starts at the edge.
  await page.evaluate(() => setMode('room'));
  const centre = await box(page, '.centre');
  expect(centre.x).toBe(0);
  const bar = await box(page, 'header.menubar');
  // Every destination sits in the bar.
  const outside = await page.evaluate((barB) => [...document.querySelectorAll('#leftRail .rl-item')]
    .filter((b) => b.getClientRects().length && b.getBoundingClientRect().bottom > barB + 0.5)
    .map((b) => b.textContent.trim()), bar.b);
  expect(outside).toEqual([]);
});

test('one bar, one row: the menus, the workspaces, the transport and Settings share it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setMode('room'));
  const bar = await box(page, 'header.menubar');
  expect(bar.h).toBeLessThanOrEqual(40);
  for (const sel of ['#menuBar .menu-title', '#leftRail [data-mode="room"]', '#playBtn', '#timeNow', '#settingsOpen']) {
    const b = await box(page, sel);
    expect(b, sel).toBeTruthy();
    expect(b.y, `${sel} is in the bar`).toBeGreaterThanOrEqual(bar.y - 0.5);
    expect(b.b, `${sel} is in the bar`).toBeLessThanOrEqual(bar.b + 0.5);
  }
});

test('the workspaces are words, and the lit one is where you are', async ({ page }) => {
  await boot(page);
  for (const [mode, word] of [['room', 'Visual'], ['seq', 'Seq'], ['overview', 'Browse']]) {
    await page.locator(`#leftRail .rl-item[data-mode="${mode}"]`).click();
    await expect.poll(() => page.evaluate(() => state.mode)).toBe(mode);
    const lit = await page.evaluate(() => [...document.querySelectorAll('#leftRail .rl-on')].map((b) => b.textContent.trim()));
    expect(lit).toEqual([word]);
  }
});

test('the transport is in the bar wherever there is something to play, and gone from Browse', async ({ page }) => {
  await boot(page);
  const shown = () => page.evaluate(() => !!$('playBtn').getClientRects().length);
  await page.evaluate(() => setMode('overview'));
  expect(await shown()).toBe(false);
  await page.evaluate(() => setMode('seq'));
  expect(await shown()).toBe(true);
  await page.evaluate(() => setMode('room'));
  expect(await shown()).toBe(true);
  expect(await page.evaluate(() => !!$('playBtn').closest('header.menubar'))).toBe(true);
});

test('Play is on screen once in Seq, and Record once', async ({ page }) => {
  await openSeq(page);
  const seen = await page.evaluate(() => {
    const doc = $('seqFrame').contentDocument;
    const vis = (root, re) => [...root.querySelectorAll('button')]
      .filter((b) => b.getClientRects().length && re.test(b.id + ' ' + b.className + ' ' + b.textContent));
    return {
      play: vis(document, /play/i).length + vis(doc, /\bplay/i).length,
      capture: vis(document, /recBtn|capture/i).length + vis(doc, /capture|REC\b/).length,
    };
  });
  expect(seen.play).toBe(1);
  expect(seen.capture).toBe(1);
});

test('with no sound open, the bar\'s Play runs the sequencer', async ({ page }) => {
  await openSeq(page);
  const frameOn = () => page.evaluate(() => $('seqFrame').contentDocument.getElementById('playBtn').classList.contains('active'));
  expect(await page.evaluate(() => !engine.path)).toBe(true);
  await page.locator('#playBtn').click();
  await expect.poll(frameOn).toBe(true);
  expect(await page.evaluate(() => $('playBtn').classList.contains('on'))).toBe(true);
  await page.locator('#stopBtn').click();
  await expect.poll(frameOn).toBe(false);
});

test('Seq has no title of its own and no empty strip over it', async ({ page }) => {
  await openSeq(page);
  expect(await page.evaluate(() => !!$('overview').getClientRects().length)).toBe(false);
  const header = await page.evaluate(() => !!$('seqFrame').contentDocument.querySelector('.header').getClientRects().length);
  expect(header).toBe(false);
  // The first synth control is within 120px of the top of the window: the bar
  // and the sequencer's own thin toolbar, and nothing else.
  const top = await page.evaluate(() => {
    const f = $('seqFrame');
    return f.getBoundingClientRect().top + f.contentDocument.querySelector('.synth-row').getBoundingClientRect().top;
  });
  expect(top).toBeLessThan(120);
});

test('the step grid has no empty band under it', async ({ page }) => {
  await openSeq(page);
  const gap = await page.evaluate(() => {
    const doc = $('seqFrame').contentDocument;
    const panel = doc.querySelector('.seq-panel');
    const kids = [...panel.querySelectorAll('*')].filter((e) => e.getClientRects().length);
    const bottom = Math.max(...kids.map((e) => e.getBoundingClientRect().bottom));
    return panel.getBoundingClientRect().bottom - bottom;
  });
  expect(gap).toBeLessThan(24);
});

test('the sequencer wears the app\'s type and palette, and follows the theme', async ({ page }) => {
  await openSeq(page);
  const look = () => page.evaluate(() => {
    const doc = $('seqFrame').contentDocument;
    const probe = (root, v) => {
      const d = root.createElement('i');
      d.style.color = `var(${v})`;
      root.body.appendChild(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    };
    const tiny = [...doc.querySelectorAll('body *')]
      .filter((e) => e.children.length === 0 && e.textContent.trim() && e.getClientRects().length)
      .filter((e) => parseFloat(doc.defaultView.getComputedStyle(e).fontSize) < 10)
      .map((e) => `${e.className}: ${e.textContent.trim().slice(0, 12)}`);
    return {
      font: doc.defaultView.getComputedStyle(doc.body).fontFamily,
      app: probe(document, '--accent'),
      seq: probe(doc, '--accent'),
      bg: [getComputedStyle(document.body).backgroundColor, doc.defaultView.getComputedStyle(doc.body).backgroundColor],
      tiny,
    };
  });
  const a = await look();
  expect(a.font).toMatch(/Inter/);
  expect(a.seq).toBe(a.app);
  expect(a.tiny, 'text under 10px').toEqual([]);
  // The theme reaches into the frame.
  await page.evaluate(() => document.documentElement.style.setProperty('--accent', 'rgb(255, 0, 128)'));
  await expect.poll(async () => (await look()).seq).toBe('rgb(255, 0, 128)');
});

test('the library drawer opens under the bar, not over it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setMode('room'));
  await page.locator('#leftRail .rl-item[data-panel="theme"]').click();
  await page.waitForTimeout(300);
  const bar = await box(page, 'header.menubar');
  const panel = await box(page, '#leftPanel');
  expect(panel.x).toBeGreaterThanOrEqual(-0.5);
  expect(panel.y).toBeGreaterThanOrEqual(bar.b - 0.5);
});

test('Browse\'s own parts are in the bar while Browse is lit', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setMode('overview'));
  const bar = await box(page, 'header.menubar');
  const map = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#leftRail .rl-child')].find((c) => c.textContent.includes('Map'));
    const r = b?.getClientRects().length ? b.getBoundingClientRect() : null;
    return r && { b: r.bottom };
  });
  expect(map).toBeTruthy();
  expect(map.b).toBeLessThanOrEqual(bar.b + 0.5);
});
