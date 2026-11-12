// Each page's preset bar loads and saves, through the storage that page already
// had: Grain's on the server, Chop's and Visual's in the browser, Wave's patch
// and board on the engine, Prism's on the server per process. The bar itself is
// pinned in `preset-bar.spec.mjs`; this is that each page's adapter is wired.
//
// The scratch server's output is muted; nothing here plays.

import { test, expect } from './test.mjs';
import { pbSaveAs, pbPick, pbRename, pbDelete, pbMenu, pbName, pbLit } from './preset-bar.helpers.mjs';

const stamp = () => `${Date.now() % 1e6}`;

async function home(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function' && (state.folders || []).length > 0, null, { timeout: 20_000 });
}

async function openSound(page) {
  await page.evaluate(async () => {
    const f = await api(`/api/files?folder=${encodeURIComponent(state.folders[0].name)}`);
    await selectFile(f.find((x) => /tone/.test(x.path)) || f[0]);
  });
}

test('Grain: the bar saves to /api/presets and loads it back', async ({ page }) => {
  await home(page);
  await page.evaluate(() => setGrainUi('synth'));
  await openSound(page);
  await page.evaluate(() => setMode('edit'));
  await page.waitForFunction(() => document.querySelector('#gsEngTabs .gs-tab.on') && state.overview, null, { timeout: 20_000 });
  const name = `bars grain ${stamp()}`;
  const win = await page.evaluate(() => state.stretchDraft.windowMs);
  await pbSaveAs(page, 'gs', name);
  await expect.poll(async () => (await (await page.request.get('/api/presets')).json()).presets.map((p) => p.name)).toContain(name);
  await page.evaluate(async (w) => { gsSetV('windowMs', w); await gsPostAll(); }, win + 20);
  await expect.poll(() => pbLit(page, 'gs')).toBe(true);
  await pbPick(page, 'gs', name);
  await expect.poll(() => page.evaluate(() => state.stretchDraft.windowMs)).toBeCloseTo(win, 1);
  await pbDelete(page, 'gs');
  await expect.poll(async () => (await (await page.request.get('/api/presets')).json()).presets.map((p) => p.name)).not.toContain(name);
});

test('Chop: the bar saves to the browser and loads it back', async ({ page }) => {
  await home(page);
  await page.evaluate(() => { localStorage.removeItem('chopPresets'); });
  await openSound(page);
  await page.evaluate(() => { setEditPage('chop'); setMode('edit'); });
  await expect(page.locator('#chopPb')).toBeVisible();
  const sens = () => page.evaluate(() => window.Chop.settings.sens);
  await page.evaluate(() => window.Chop.set({ sens: 81 }));
  await pbSaveAs(page, 'chop', 'Bars chop');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chopPresets')).map((p) => [p.name, p.cp.sens]))).toEqual([['Bars chop', 81]]);
  await page.evaluate(() => window.Chop.set({ sens: 33 }));
  await pbPick(page, 'chop', 'Bars chop');
  expect(await sens()).toBe(81);
  await pbDelete(page, 'chop');
  expect(await page.evaluate(() => chopPresets().length)).toBe(0);
});

test('Wave patch: the bar saves, renames and deletes through the engine, and loads it back', async ({ page }) => {
  await home(page);
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await page.waitForFunction(() => WV.connected && WV.built, null, { timeout: 8_000 });
  const names = async () => (await (await page.request.get('/api/wave/presets')).json()).map((p) => p.name);
  const name = `Bars patch ${stamp()}`;
  await page.evaluate(() => wvCommit('osc0.pos', 0.25));
  await pbSaveAs(page, 'wv', name);
  await expect.poll(names).toContain(name);
  await expect.poll(() => pbName(page, 'wv')).toBe(name);
  await page.evaluate(() => wvCommit('osc0.pos', 0.8));
  await expect.poll(() => pbLit(page, 'wv')).toBe(true);
  await pbPick(page, 'wv', name);
  await expect.poll(() => page.evaluate(() => WV.p['osc0.pos'])).toBeCloseTo(0.25, 3);
  await pbRename(page, 'wv', `${name} r`);
  await expect.poll(names).toContain(`${name} r`);
  await expect.poll(names).not.toContain(name);
  await expect.poll(() => pbName(page, 'wv')).toBe(`${name} r`);
  await pbDelete(page, 'wv');
  await expect.poll(names).not.toContain(`${name} r`);
  // Init: the engine's own default patch.
  await pbMenu(page, 'wv', 'init');
  await expect.poll(() => pbName(page, 'wv')).toBe('Init');
  expect((await (await page.request.get('/api/wave/patch')).json()).name).toBe('Init');
});

test('Wave FX board: the bar saves to the engine and loads it back', async ({ page }) => {
  await home(page);
  await page.locator('#leftRail .rl-item[data-mode="synth"]').click();
  await page.waitForFunction(() => WV.connected && WV.board && WV_FXCAT.list.length > 0, null, { timeout: 8_000 });
  await page.locator('#wvViews [data-v="fx"]').click();
  const names = async () => (await (await page.request.get('/api/wave/boards')).json()).map((b) => b.name);
  const name = `Bars board ${stamp()}`;
  await pbPick(page, 'wvB', 'Dub Room');
  await expect.poll(() => pbName(page, 'wvB')).toBe('Dub Room');
  await pbSaveAs(page, 'wvB', name);
  await expect.poll(names).toContain(name);
  await pbPick(page, 'wvB', 'Glass Split');
  await expect.poll(() => pbName(page, 'wvB')).toBe('Glass Split');
  await pbPick(page, 'wvB', name);
  await expect.poll(() => page.evaluate(() => WV.board.name)).toBe(name);
  await pbRename(page, 'wvB', `${name} r`);
  await expect.poll(names).toContain(`${name} r`);
  await expect.poll(names).not.toContain(name);
  await pbDelete(page, 'wvB');
  await expect.poll(names).not.toContain(`${name} r`);
});

test('Prism: the bar saves the process\'s preset to the server and loads it back', async ({ page }) => {
  await page.route('**/api/prism/load**', (route) => {
    const p = new URL(route.request().url()).searchParams.get('p');
    route.fulfill({ json: { path: p, frames: 96000, sampleRate: 48000 } });
  });
  await page.route('**/api/prism/state**', (route) => route.fulfill({ json: { playing: false, position: 0 } }));
  await home(page);
  await openSound(page);
  await page.evaluate(() => setMode('edit'));
  await page.locator('#leftRail .rl-item[data-page="prism"]').click();
  await page.evaluate(() => window.prismDeck.use(state.selectedFile.path));
  await page.waitForFunction(() => (window.prismPad?.sources || []).length > 0);
  await page.locator('#prismSource').selectOption({ label: 'Pitch Time Changer' });
  const name = `Bars prism ${stamp()}`;
  const mine = async () => (await (await page.request.get('/api/pad/presets?kind=ptc')).json()).user.map((p) => p.name);
  await pbSaveAs(page, 'prism', name);
  await expect.poll(mine).toContain(name);
  await pbMenu(page, 'prism', 'init');
  await expect.poll(() => pbName(page, 'prism')).toBe('Default Settings');
  await pbPick(page, 'prism', name);
  await expect.poll(() => pbName(page, 'prism')).toBe(name);
  await pbDelete(page, 'prism');
  await expect.poll(mine).not.toContain(name);
});

test('Visual: the LOOK bar saves to the browser and loads it back', async ({ page }) => {
  await home(page);
  await page.evaluate(() => { localStorage.removeItem(SectionPresets.keyFor('visual')); setMode('room'); });
  await page.waitForSelector('#roomStageRoom #visGl', { state: 'visible', timeout: 20_000 });
  await expect(page.locator('#vpPb')).toBeVisible();
  const was = await page.evaluate(() => roomEdit.opacity);
  try {
    await page.evaluate(() => { roomEdit.opacity = 0.41; syncRoomSliders(); });
    await pbSaveAs(page, 'vp', 'Bars look');
    expect(await page.evaluate(() => SectionPresets.get(localStorage, 'visual', 'Bars look').room.opacity)).toBe(0.41);
    await page.evaluate(() => { roomEdit.opacity = 0.9; });
    await expect.poll(() => pbLit(page, 'vp')).toBe(true);
    await pbPick(page, 'vp', 'Bars look');
    expect(await page.evaluate(() => roomEdit.opacity)).toBe(0.41);
    await pbRename(page, 'vp', 'Bars look 2');
    expect(await page.evaluate(() => SectionPresets.list(localStorage, 'visual').map((p) => p.name))).toEqual(['Bars look 2']);
    await pbDelete(page, 'vp');
    expect(await page.evaluate(() => SectionPresets.list(localStorage, 'visual').length)).toBe(0);
  } finally {
    await page.evaluate((o) => { roomEdit.opacity = o; saveRoomData(); syncRoomSliders(); }, was);
  }
});
