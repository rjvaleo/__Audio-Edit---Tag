// What the `design-pass` specs share.

import { test, expect } from './test.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI = join(dirname(fileURLToPath(import.meta.url)), '../../ui');

/// The type scale, in px. `--fs-xs` … `--fs-xl` in `app.css`.
export const SCALE = [9, 10, 11, 13, 16];

export async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
}

export async function openFile(page) {
  await ready(page);
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

export async function dockTab(page, name) {
  // Prism is a page of its own in the left rail since 4 Nov 2026; every other
  // tab belongs to the Grain page.
  if (name === 'prism') {
    await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  } else {
    if (await page.evaluate(() => document.body.classList.contains('prismpage'))) {
      await page.locator('#leftRail .rl-item[data-page="grain"]').click();
    }
    await page.locator(`.dock-tab[data-dock="${name}"]`).click();
  }
  await page.waitForTimeout(300);
}

export async function roomTab(page, name) {
  await page.evaluate(() => setMode('room'));
  await page.locator(`#roomAdmin .rv-tab[data-rvtab="${name}"]`).click();
  await page.waitForTimeout(300);
}

/// Every visible element that prints words of its own, with its size. Glyphs
/// (▶ ⟲ ×) are icons and are sized as icons; the room's data block is part of
/// the picture, printed on the wall, and keeps its own size.
export const sizesOnScreen = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.room-data, .theme-mini, svg, canvas')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!/[A-Za-z0-9]/.test(own)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    out.push({ size: parseFloat(cs.fontSize), what: (el.id || el.className || el.tagName) + ': ' + own.slice(0, 24) });
  }
  return out;
})()`;
