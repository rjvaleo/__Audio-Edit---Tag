// The Prism page as RJ's mock-up has it (13 Nov 2026,
// `page-mockups/hyperprism.html`): the sound slim along the top in its own
// colours, the pad the page, and the rest in the app's own panels.
//
// What this pins:
//   - the green wave and the spectrogram are gone from the page; SOURCE, the
//     whole of Prism's sound about 58 px high, is in their place, with its
//     meta line, coloured by the sound once it is measured, and a click on it
//     seeks the Prism deck;
//   - the pad fills everything left of the panels, at any window size, and
//     the window's width goes to it;
//   - every control of the process is the app's shared knob with its picture,
//     in the grain facets' colours;
//   - Takes, LFOs and Output are panels with wells, the shared bars and
//     switches; the shared preset bar is in the PRISM row.
//
// Loading a sound opens the audio device, which the scratch server must never
// do, so `/api/prism/load` and `/api/prism/state` are answered here.

import { test, expect } from './test.mjs';

async function openPrism(page) {
  const sent = [];
  await page.route('**/api/prism/load**', (route) => {
    const p = new URL(route.request().url()).searchParams.get('p');
    route.fulfill({ json: { path: p, frames: 96000, sampleRate: 48000 } });
  });
  await page.route('**/api/prism/state**', (route) => route.fulfill({ json: { playing: false, position: 0 } }));
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/engine/transport')) sent.push(r.postDataJSON());
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async () => {
    try { for (const k of Object.keys(localStorage)) if (/^(hyperstretch|prism\.)/.test(k)) localStorage.removeItem(k); } catch {}
    const files = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await postJSON('/api/rack', { p: `prism:${files[0].path}`, sr: 44100, slots: [] });
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await page.evaluate(() => window.prismDeck.use(state.selectedFile.path));
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
  return sent;
}

/// Where the pad and the panels are, against the page.
const measure = (page) => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const dock = r(document.getElementById('dockHyper')), pad = r(document.getElementById('hsPad'));
  const banks = r(document.querySelector('#dockHyper .hs-banks'));
  return { left: pad.left - dock.left, bottom: dock.bottom - pad.bottom, gap: banks.left - pad.right,
    w: pad.width, h: pad.height, banksW: banks.width, inDock: banks.right <= dock.right + 1 };
});

test('the green wave and the spectrogram go: SOURCE is the sound, slim, in its colours', async ({ page }) => {
  const sent = await openPrism(page);
  for (const id of ['lane', 'overview', 'ruler', 'transportBar']) await expect(page.locator(`#${id}`)).toBeHidden();
  const src = page.locator('#dockHyper .hs-src #prismSrc');
  await expect(src).toBeVisible();
  const b = await src.boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(54);
  expect(b.height).toBeLessThanOrEqual(62);
  // Across the whole page, above the PRISM row.
  const head = await page.locator('#dockHyper .hs-head').boundingBox();
  expect(b.width).toBeGreaterThan(head.width - 30);
  expect(b.y + b.height).toBeLessThan(head.y);
  // The meta line and the Edit button, as the mock-up has them.
  const file = await page.evaluate(() => window.prismDeck.path().split('/').pop());
  await expect(page.locator('#prismSoundName')).toHaveText(file);
  await expect(page.locator('#prismSoundMeta')).toContainText(' Hz');
  await expect(page.locator('#prismSoundMeta')).toContainText(' ch');
  await expect(page.locator('#prismSoundMeta')).toContainText(' s');
  await expect(page.locator('#prismEdit')).toBeVisible();
  // Coloured: once the sound is measured, its peaks are drawn in Chop's
  // spectrum colours, opaque, where the plain wave is a faint wash.
  await page.waitForFunction(() => edSound.an && edSound.path === window.prismDeck.path(), null, { timeout: 15_000 });
  const lit = await page.evaluate(() => {
    prismDeckShowWave();
    const c = document.getElementById('prismSrc');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(200);
  // A click on it seeks the Prism deck, as the bar's strip does.
  await src.click({ position: { x: b.width / 2, y: b.height / 2 } });
  await expect.poll(() => sent.filter((s) => s.deck === 'prism' && Number.isFinite(s.seek)).at(-1)?.seek ?? -1).toBeGreaterThan(40_000);
  const seek = sent.filter((s) => s.deck === 'prism' && Number.isFinite(s.seek)).at(-1).seek;
  expect(seek).toBeLessThan(56_000);
  // The Sound row keeps its picker and its mini overview.
  for (const id of ['prismSoundFolder', 'prismSoundFile', 'prismWave', 'prismChainAdd']) await expect(page.locator(`#dockHyper .hs-deck #${id}`)).toBeAttached();
  await expect(page.locator('#dockHyper .hs-deck #prismWave')).toBeVisible();
});

test('the pad is the page: it fills everything left of the panels at any window size', async ({ page }) => {
  await page.setViewportSize({ width: 2100, height: 1100 });
  await openPrism(page);
  await page.waitForTimeout(300);
  const wide = await measure(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForTimeout(400);
  const narrow = await measure(page);
  for (const m of [wide, narrow]) {
    // Only the page's margin and the pad panel's frame to its left and below it.
    expect(m.left).toBeLessThanOrEqual(24);
    expect(m.bottom).toBeLessThanOrEqual(24);
    // The panels hard against it, and all of them on the page.
    expect(m.gap).toBeGreaterThanOrEqual(0);
    expect(m.gap).toBeLessThanOrEqual(24);
    expect(m.inDock).toBe(true);
    expect(m.h).toBeGreaterThan(400);
  }
  // The panels keep their widths; the window's width and height go to the pad.
  expect(narrow.banksW).toBe(wide.banksW);
  expect(wide.w - narrow.w).toBeGreaterThanOrEqual(590);
  expect(wide.h - narrow.h).toBeGreaterThanOrEqual(190);
  // It draws in what it is.
  const size = await page.evaluate(() => window.hyperStretch.size());
  expect(Math.abs(size.w - narrow.w)).toBeLessThanOrEqual(1);
  expect(Math.abs(size.h - narrow.h)).toBeLessThanOrEqual(1);
});

test('the controls are the shared knobs, with their pictures, in the facet colours', async ({ page }) => {
  await openPrism(page);
  const rows = page.locator('#prismSettings .param');
  await expect(rows).toHaveCount(4);
  const knobs = await rows.evaluateAll((els) => els.map((row) => {
    const k = row.querySelector('.ui-knob.s26');
    const pic = k?.querySelector('.ui-pic');
    const root = getComputedStyle(document.documentElement);
    const facet = PRISM_PIC.facetOf(row.dataset.key);
    // The picture's ink against the grain facet's colour, both as the browser resolves them.
    const probe = document.createElement('i');
    probe.style.color = root.getPropertyValue(`--look-f-${facet}`).trim();
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { key: row.dataset.key, knob: !!k, ring: !!k?.querySelector('[role=slider]'), pic: !!pic?.innerHTML.trim(),
      ink: pic ? getComputedStyle(pic.querySelector('.a') || pic).stroke : '', want };
  }));
  expect(knobs.map((k) => k.key)).toEqual(['ratio', 'semitones', 'windowMs', 'cloudMix']);
  for (const k of knobs) {
    expect(k.knob, k.key).toBe(true);
    expect(k.ring, k.key).toBe(true);
    expect(k.pic, k.key).toBe(true);
    expect(k.ink, k.key).toBe(k.want);
  }
  // Turning one moves what its slider moved: the Prism deck's Window.
  const before = await page.evaluate(() => window.prismDeck.stretch().windowMs);
  const kn = await rows.nth(2).locator('.ui-kn').boundingBox();
  await page.mouse.move(kn.x + kn.width / 2, kn.y + kn.height / 2);
  await page.mouse.down();
  await page.mouse.move(kn.x + kn.width / 2, kn.y + kn.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.prismDeck.stretch().windowMs);
  expect(after).toBeGreaterThan(before);
  // The knob and the row under it say the same.
  expect(await rows.nth(2).locator('.ui-kval').textContent()).toBe(await rows.nth(2).locator(':scope > .v').textContent());
  // The LFOs' Rate and Depth are knobs too.
  await expect(page.locator('#prismLfoBars .ui-knob')).toHaveCount(2);
});

test('Takes, LFOs and Output are panels with wells; the preset bar is in the PRISM row', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openPrism(page);
  for (const name of ['Source', 'Pad', 'Controls', 'LFOs', 'Takes', 'Output']) {
    await expect(page.locator(`#dockHyper .prism-panel[aria-label="${name}"]`)).toBeVisible();
  }
  // Wells: the four takes, the LFO's scope, the three faders, SOURCE.
  await expect(page.locator('#dockHyper .prism-takes .hs-slot')).toHaveCount(4);
  await expect(page.locator('#dockHyper .prism-lfos .prism-well')).toHaveCount(1);
  await expect(page.locator('#dockHyper .prism-out .prism-well')).toHaveCount(3);
  // The shared bars and switches.
  await expect(page.locator('#prismTakeBars .ui-bar')).toHaveCount(3);
  await expect(page.locator('#dockHyper .prism-takes .ui-seg')).toHaveCount(3);
  // Orange means on: the take picked, a shape drawn, a switch on.
  const on = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--on').trim());
  const probe = await page.evaluate((c) => { const i = document.createElement('i'); i.style.color = c; document.body.append(i); const v = getComputedStyle(i).color; i.remove(); return v; }, on);
  expect(await page.locator('.hs-slot.on').evaluate((e) => getComputedStyle(e).color)).toBe(probe);
  await page.locator('#hsThrow').check();
  expect(await page.locator('.hs-tog:has(#hsThrow)').evaluate((e) => getComputedStyle(e).color)).toBe(probe);
  await page.locator('#hsThrow').uncheck();
  // The shared preset bar, in the PRISM row, on its line at 1500 px.
  await expect(page.locator('#dockHyper .hs-head #prismPb')).toBeVisible();
  const pb = await page.locator('#prismPb').boundingBox();
  const pick = await page.locator('#prismPickBtn').boundingBox();
  expect(Math.abs((pb.y + pb.height / 2) - (pick.y + pick.height / 2))).toBeLessThanOrEqual(4);
  // The faders still read in dB.
  await expect(page.locator('#prismFaderLRead')).toHaveText('+0.1 dB');
});
