// The Prism page, v7 (RJ, 6 Nov 2026, after the design council: "less color,
// less chaos, less candy, more professional"; the mock-up he chose over v6).
//
// What this pins:
//   - the Process menu offers all 32 processes (Time & Pitch, the Pitch Time
//     Changer and Hyperprism's 30), each with its picture, opening inside the
//     panel; choosing one not in Prism's chain adds it and puts it on the pad;
//   - every control is the app's shared knob with its picture, the pad's two
//     first (half-width bars until the mock-up of 13 Nov 2026);
//   - four LFOs under the controls: Map then a click on a control maps it, its
//     knob shows the LFO's reach, and the deck hears the swing while the
//     setting stays where the hand left it;
//   - the panels beside the pad have fixed widths, and nothing spills out of
//     them or cuts a control's name.

import { test, expect } from './test.mjs';

async function openPrism(page) {
  await page.route('**/api/prism/load**', (route) => {
    const p = new URL(route.request().url()).searchParams.get('p');
    route.fulfill({ json: { path: p, frames: 96000, sampleRate: 48000 } });
  });
  await page.route('**/api/prism/state**', (route) => route.fulfill({ json: { playing: false, position: 0 } }));
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0, { timeout: 20_000 });
  await page.evaluate(async () => {
    try { for (const k of Object.keys(localStorage)) if (/^(hyperstretch|prism\.)/.test(k)) localStorage.removeItem(k); } catch {}
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await postJSON('/api/rack', { p: `prism:${files[0].path}`, sr: 44100, slots: [] });
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await page.evaluate(() => window.prismDeck.use(state.selectedFile.path));
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
  await page.waitForFunction(() => Object.keys(state.shapers || {}).some((k) => k.startsWith('prism:hp-')));
}

test('the Process menu has all 32, with pictures, inside the panel', async ({ page }) => {
  await openPrism(page);
  await page.locator('#prismPickBtn').click();
  const menu = page.locator('#prismPickMenu');
  await expect(menu).toBeVisible();
  const items = menu.locator('.ppick-i');
  const labels = await items.allTextContents();
  expect(labels.length).toBeGreaterThanOrEqual(32);
  for (const name of ['Time & Pitch', 'Pitch Time Changer', 'Low Pass', 'Multi Delay', 'Chorus', 'Hall Reverb', 'Hyper Stereo', 'Sonic Decimator'])
    expect(labels.map((t) => t.trim())).toContain(name);
  // Every one has a picture, and none is cut short.
  expect(await items.evaluateAll((els) => els.filter((b) => !b.querySelector('svg.pic')?.innerHTML.trim()).length)).toBe(0);
  expect(await items.evaluateAll((els) => els.filter((b) => b.scrollWidth > b.clientWidth + 1).length)).toBe(0);
  // It opens inside the panel, so nothing of it is off the screen.
  const box = await menu.boundingBox();
  const vh = await page.evaluate(() => innerHeight);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('choosing a Hyperprism process not in the chain adds it and puts it on the pad', async ({ page }) => {
  await openPrism(page);
  await page.locator('#prismPickBtn').click();
  await page.locator('#prismPickMenu .ppick-i', { hasText: 'Flanger' }).click();
  await expect.poll(() => page.evaluate(() => prismDeck.rack.slots.map((s) => s.kind))).toContain('prism:hp-flanger');
  const onPad = await page.evaluate(() => prismDeck.rack.slots.find((s) => s.kind === 'prism:hp-flanger').id === prismPad.source);
  expect(onPad).toBe(true);
  await expect(page.locator('#prismPickBtn')).toContainText('Flanger');
  // Its every setting is a knob with its picture, the pad's two first.
  const keys = await page.locator('#prismSettings .prism-bar').evaluateAll((els) => els.map((e) => e.dataset.key));
  const want = await page.evaluate(() => state.shapers['prism:hp-flanger'].params.map((p) => p.key));
  expect([...keys].sort()).toEqual([...want].sort());
  const p = await page.evaluate(() => prismSetup());
  expect(keys.slice(0, 2)).toEqual([p.x, p.y]);
  await expect(page.locator('#prismSettings .prism-bar .ui-knob')).toHaveCount(keys.length);
  expect(await page.locator('#prismSettings .prism-bar .ui-knob .ui-pic').evaluateAll((els) => els.filter((g) => !g.innerHTML.trim()).length)).toBe(0);
  // Knobs side by side, several to a line.
  const [a, b] = await page.locator('#prismSettings .prism-bar').evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().toJSON()));
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
});

test('an LFO mapped to a control swings what the deck hears, not the setting', async ({ page }) => {
  await openPrism(page);
  await page.locator('#prismPickBtn').click();
  await page.locator('#prismPickMenu .ppick-i', { hasText: 'Chorus' }).click();
  await expect.poll(() => page.evaluate(() => prismPad.source !== 'stretch')).toBe(true);
  const sent = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/rack/param')) sent.push(r.postDataJSON()); });
  // Depth to the top, so the swing is plain.
  await page.evaluate(() => { prismLfo.lfos[0].depth = 100; prismLfoRender(); });
  await page.locator('#prismLfoMap').click();
  const bar = page.locator('#prismSettings .prism-bar').nth(2);
  const key = await bar.getAttribute('data-key');
  const before = await page.evaluate((k) => prismDeck.rack.slots.find((s) => s.id === prismPad.source).params[k], key);
  await bar.locator('.ui-kn').click();
  await expect(bar).toHaveClass(/plfo-on/);
  await expect(page.locator('#prismLfos .plfo-chip')).toHaveCount(1);
  // The knob shows the LFO's reach round its ring.
  await expect(bar.locator('.ui-kn')).toHaveClass(/\bmod\b/);
  await page.waitForTimeout(1200);
  const mine = sent.filter((b) => b.key === key);
  expect(mine.length).toBeGreaterThan(5);
  expect(new Set(mine.map((b) => b.value.toFixed(3))).size).toBeGreaterThan(2);
  expect(mine.every((b) => b.p.startsWith('prism:') && b.live === true)).toBe(true);
  // Nor does the document keep the swing.
  const stored = await page.evaluate(async (k) => (await api(`/api/rack?p=${encodeURIComponent(prismKey())}`)).slots
    .find((s) => s.id === prismPad.source).params[k], key);
  expect(stored).toBe(before);
  // The setting is still the hand's.
  const after = await page.evaluate((k) => prismDeck.rack.slots.find((s) => s.id === prismPad.source).params[k], key);
  expect(after).toBe(before);
  // Clicking it again in Map unmaps it, and the setting goes back to the deck.
  await page.locator('#prismLfoMap').click();
  await bar.locator('.ui-kn').click();
  await expect(bar).not.toHaveClass(/plfo-on/);
  await expect(page.locator('#prismLfos .plfo-chip')).toHaveCount(0);
});

test('the panels have fixed widths and nothing spills out of them', async ({ page }) => {
  await openPrism(page);
  const widths = async () => page.locator('#dockHyper .hs-bank').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const first = await widths();
  // Controls and LFOs one column, Takes, Output.
  expect(first).toEqual([396, 396, 236, 104]);
  await page.setViewportSize({ width: 1700, height: 900 });
  expect(await widths()).toEqual(first);
  for (const kind of ['prism:hp-multi-delay', 'prism:hp-pitch-shifter', 'prism:hp-hall']) {
    await page.locator('#prismPickBtn').click();
    await page.locator(`#prismPickMenu .ppick-i[data-kind="${kind}"]`).click();
    await expect.poll(() => page.evaluate((k) => prismDeck.rack.slots.find((s) => s.id === prismPad.source)?.kind, kind)).toBe(kind);
    const spill = await page.locator('#dockHyper .hs-bank').evaluateAll((els) => els.filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.getAttribute('aria-label')));
    expect(spill).toEqual([]);
    // No knob's name or reading is cut or runs into the next knob.
    const cut = await page.locator('#prismSettings .prism-bar').evaluateAll((els) => els.filter((r) => {
      const box = r.getBoundingClientRect();
      return [...r.querySelectorAll('.ui-kname, .ui-kval')].some((t) => {
        const b = t.getBoundingClientRect();
        return t.scrollWidth > t.clientWidth + 1 || b.left < box.left - 1 || b.right > box.right + 1;
      });
    }).map((r) => r.dataset.key));
    expect(cut).toEqual([]);
  }
});
