// The FX page (`425-fx-page.js`): a sound from the library or the PC's own
// library through the effects suite, played straight. RJ, 14 Nov 2026.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;
function wav(path, seconds, f) {
  const n = Math.round(seconds * RATE), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f(i / RATE))) * 32000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

async function openFx(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof fxEnter === 'function', null, { timeout: 20_000 });
  // The Grain v12 page, which FX is a view of; the app turns it on everywhere but under test.
  await page.evaluate(() => { prefs.grainUi = 'synth'; });
  await page.click('#leftRail .rl-item[data-page="fx"]');
  await page.waitForFunction(() => document.body.classList.contains('fxpage'));
}

test('FX opens, and shows the sources and the effects with no grain engine', async ({ page }) => {
  // With nothing of the user's open, the app's own pulse wave is (main, 18 Nov), and FX opens on it.
  await openFx(page);
  await expect(page.locator('#fxSources')).toBeVisible();
  await expect(page.locator('#fxOpenName')).not.toHaveText('');
  await expect(page.locator('#gsFxView')).toBeVisible();
  await expect(page.locator('#gsEngTabs')).toBeHidden();
  await expect(page.locator('#gsCpPb')).toBeHidden();
  await expect(page.locator('#leftRail .rl-item[data-page="fx"]')).toHaveClass(/rl-on/);
});

test('FX: a library sound opens there, an effect goes on, and Save writes it through the effects', async ({ page, request }) => {
  const st = await (await request.get('/api/state')).json();
  // Everything this test writes, taken away again: every spec in a run shares the
  // scratch library, and the Stems page counts the files in sounds/ (:231).
  const mine = [join(st.library, 'sounds', 'FX Hit.wav'), join(st.library, 'sounds', 'FX')];
  try {
    mkdirSync(join(st.library, 'sounds'), { recursive: true });
    rmSync(join(st.library, 'sounds', 'FX'), { recursive: true, force: true });
    wav(join(st.library, 'sounds', 'FX Hit.wav'), 0.6, (t) => Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 6));
    await request.post('/api/scan', { data: {} });
    await expect.poll(async () => (await (await request.get('/api/files?folder=sounds')).json()).some((f) => f.name === 'FX Hit.wav'), { timeout: 15_000 }).toBe(true);
    await openFx(page);
    const file = await page.evaluate(async () => { const f = await resolveFile('sounds/FX Hit.wav'); await openInEditor(f); return state.selectedFile?.path; });
    expect(file).toBe('sounds/FX Hit.wav');
    await expect(page.locator('#fxOpenName')).toContainText('FX Hit');
    await expect(page.locator('#fxSave')).toBeEnabled();
    expect(await page.evaluate(() => editPage)).toBe('fx');
    // The suite's picker, from the page's own + Add effect.
    await page.click('#gsFxAddChip');
    await expect(page.locator('#fxPicker')).toBeVisible();
    await page.locator('#fxPicker button', { hasText: 'Close' }).first().click();
    await expect(page.locator('#fxPicker')).toBeHidden();
    // Save: through the chain, into FX/ beside the sound.
    await page.click('#fxSave');
    const fxDir = join(st.library, 'sounds', 'FX');
    await expect.poll(() => (existsSync(fxDir) ? readdirSync(fxDir).filter((n) => n.startsWith('FX Hit')).length : 0), { timeout: 30_000 }).toBeGreaterThan(0);
    // Grain: its own engine view comes back, and the sources go.
    await page.click('#leftRail .rl-item[data-page="grain"]');
    await expect(page.locator('#fxSources')).toHaveCount(0);
    await expect(page.locator('#gsEngTabs')).toBeVisible();
  } finally {
    for (const p of mine) rmSync(p, { recursive: true, force: true });
    await request.post('/api/scan', { data: {} });
    // Wait for that scan to land: one still running when the next spec saves a
    // file puts back an index from before the save (stems-page :106).
    await expect.poll(async () => (await (await request.get('/api/files?folder=sounds')).json()).some((f) => f.name === 'FX Hit.wav'), { timeout: 30_000 }).toBe(false);
    await expect.poll(async () => (await (await request.get('/api/scan')).json().catch(() => ({}))).running ?? false, { timeout: 30_000 }).toBe(false);
  }
});

test('the PC library routes say plainly when there is no GPU machine, and refuse anything outside it', async ({ request }) => {
  const s = await (await request.get('/api/stems')).json();
  const lib = await request.get('/api/pc/library');
  if (!s.gpu) expect(lib.status()).toBe(503);
  expect((await request.post('/api/pc/fetch', { data: { file: '../../etc/passwd' } })).status()).toBeGreaterThanOrEqual(400);
  expect((await request.post('/api/pc/fetch', { data: { file: 'sounds/x/../../a.wav' } })).status()).toBeGreaterThanOrEqual(400);
});
