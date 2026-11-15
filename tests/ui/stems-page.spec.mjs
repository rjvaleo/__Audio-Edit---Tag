// The Stems page (14 Nov 2026, from the mock-up RJ approved).
//
// Split a song into stems, read what is in it, and make sounds from it. The
// split itself needs the demucs helper and minutes of GPU, so these tests do
// not run it: they lay a small song's stems into the scratch library's
// `Stems/` folder (a click every beat at 120 BPM for the drums, a sine for the
// bass), which is exactly what a split leaves, and prove the page from there.
// The split route is proved by hand on real songs; see `docs/STEMS.md`.

import { test, expect } from './test.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;

/// A 16-bit stereo WAV from a function of time.
function wav(path, seconds, f) {
  const n = Math.round(seconds * RATE);
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, f(i / RATE)));
    b.writeInt16LE(Math.round(v * 32000), 44 + i * 4);
    b.writeInt16LE(Math.round(v * 32000), 46 + i * 4);
  }
  writeFileSync(path, b);
}

/// The stems a split would leave: kick on every beat and a hat between, a
/// sine bass, a quiet pad, and nothing in the vocals.
async function laySong(request) {
  const st = await (await request.get('/api/state')).json();
  const dir = join(st.library, 'Stems', 'Test Song');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const beat = 0.5;
  wav(join(dir, 'drums.wav'), 16, (t) => {
    const b = t % beat, h = (t + beat / 2) % beat;
    const kick = b < 0.25 ? Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-b * 40)) * b) * Math.exp(-b * 14) : 0;
    const hat = h < 0.04 ? (Math.random() * 2 - 1) * Math.exp(-h * 120) * 0.5 : 0;
    return kick * 0.9 + hat;
  });
  wav(join(dir, 'bass.wav'), 16, (t) => Math.sin(2 * Math.PI * 55 * t) * 0.5 * ((t % 1) < 0.8 ? 1 : 0.05));
  wav(join(dir, 'other.wav'), 16, (t) => Math.sin(2 * Math.PI * 220 * t) * 0.1);
  wav(join(dir, 'vocals.wav'), 16, () => 0);
  writeFileSync(join(dir, 'stems.json'), JSON.stringify({ source: 'kit/tone.wav', model: 'htdemucs', splitSeconds: 1 }));
  return dir;
}

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof stEnter === 'function', null, { timeout: 20_000 });
  await page.click('#leftRail .rl-item[data-mode="stems"]');
  await page.waitForFunction(() => document.body.classList.contains('stemspage'));
}

test('the rail opens Stems as a full page, with Split showing', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => ({
    mode: state.mode,
    lit: document.querySelector('#leftRail .rl-item.rl-on')?.dataset.mode,
    shown: !$('stemsView').classList.contains('hidden'),
    lane: $('lane').classList.contains('hidden'),
    split: !$('stSplit').classList.contains('hidden'),
    make: !$('stMake').classList.contains('hidden'),
    models: [...document.querySelectorAll('#stModel [role="radio"]')].map((s) => s.textContent),
    label: $('modeLabel').textContent,
  }));
  expect(got).toMatchObject({ mode: 'stems', lit: 'stems', shown: true, lane: true, split: true, make: false, label: 'Stems' });
  expect(got.models).toEqual(['4 stems', '6 stems', 'Best']);
  // The helper's state is said, whichever it is.
  await expect(page.locator('#stHelper')).toHaveText(/HT-DEMUCS|NOT INSTALLED/);
});

test('a split song lists, and opens with a lane and a waveform for each stem', async ({ page, request }) => {
  await laySong(request);
  await open(page);
  await expect(page.locator('#stList .st-it', { hasText: 'Test Song' })).toBeVisible();
  await page.locator('#stList .st-it', { hasText: 'Test Song' }).click();
  await expect(page.locator('#stLanes .st-lane')).toHaveCount(4);
  await expect(page.locator('#stSongName')).toHaveText('TEST SONG');
  // Every lane's waveform is drawn: something inked on each canvas.
  await page.waitForFunction(() => [...document.querySelectorAll('#stLanes canvas')].filter((c) => {
    if (!c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  }).length >= 3, null, { timeout: 15_000 });
  // Solo greys the others out.
  await page.locator('#stLanes .st-lane[data-stem="drums"] .solo').click();
  const off = await page.evaluate(() => [...document.querySelectorAll('#stLanes .st-lane')].map((r) => r.classList.contains('off')));
  expect(off).toEqual([false, true, true, true]);
});

test('the stems mix into one file at the levels on the page', async ({ request }) => {
  await laySong(request);
  const r = await (await request.post('/api/stems/mix', { data: { p: 'Stems/Test Song', gains: [1, 0, 0, 0] } })).json();
  expect(r.p).toBe('Stems/Test Song/.mix.wav');
  const pk = await (await request.get(`/api/peaks?p=${encodeURIComponent(r.p)}&cols=64`)).json();
  expect(pk.frames).toBe(16 * RATE);
});

test('Make: drum hits cut from the drums stem, cleaned, upsampled and saved', async ({ page, request }) => {
  await laySong(request);
  await open(page);
  await page.locator('#stTabs [role="radio"]', { hasText: 'Make a sound' }).click();
  await expect(page.locator('#stMake')).toBeVisible();
  await page.locator('#stStart [role="radio"]', { hasText: 'My stems' }).click();
  await page.selectOption('#stFrom', 'Stems/Test Song');
  await page.click('#stMakeGo');
  await expect(page.locator('#stTries .st-try').first()).toBeVisible({ timeout: 20_000 });
  const labels = await page.locator('#stTries .st-try .st-nm').allTextContents();
  expect(labels.some((l) => /^kick/.test(l))).toBe(true);
  await page.locator('#stTries .st-try').first().click();
  await expect(page.locator('#stKeep')).toBeEnabled();
  await page.fill('#stName', 'test kick');
  await page.click('#stKeep');
  await expect(page.locator('#stSaved')).toHaveText(/Made\/Drums\/test kick/, { timeout: 20_000 });
  const made = await page.evaluate(() => ST.made);
  expect(made.rate).toBe(96000);
  expect(made.seconds).toBeGreaterThan(0.05);
  await expect(page.locator('#stOpenGrain')).toBeEnabled();
  // It is in the library now.
  const files = await (await request.get('/api/files?folder=Made')).json();
  expect(files.some((f) => f.path.startsWith('Made/Drums/test kick'))).toBe(true);
});

test('Teach the Band needs an analysis, and says so', async ({ request }) => {
  await laySong(request);
  const r = await request.post('/api/stems/learn', { data: { p: 'Stems/Test Song' } });
  expect(r.status()).toBe(500);
  expect((await r.json()).error).toMatch(/not analysed/);
});

test('Make from words: its own controls, and only with a GPU machine', async ({ page, request }) => {
  await open(page);
  const st = await (await request.get('/api/stems')).json();
  await page.locator('#stTabs [role="radio"]', { hasText: 'Make a sound' }).click();
  await page.locator('#stStart [role="radio"]', { hasText: 'Words' }).click();
  await expect(page.locator('#stPrompt')).toBeVisible();
  await expect(page.locator('#stWordsBars .ui-bar')).toHaveCount(2);
  await expect(page.locator('#stFrom')).toBeHidden();
  await expect(page.locator('#stMakeGo')).toHaveText('Make them');
  if (st.gpu) {
    await expect(page.locator('#stMakeGo')).toBeEnabled();
    await expect(page.locator('#stModelNote')).toContainText(st.gpu);
  } else {
    await expect(page.locator('#stMakeGo')).toBeDisabled();
    await expect(page.locator('#stModelNote')).toContainText('AUDIOLAB_GPU_HOST');
    const r = await request.post('/api/stems/words', { data: { prompt: 'kick' } });
    expect(r.status()).toBe(503);
  }
  // Back to cutting from stems: the song picker returns.
  await page.locator('#stStart [role="radio"]', { hasText: 'My stems' }).click();
  await expect(page.locator('#stFrom')).toBeVisible();
  await expect(page.locator('#stPrompt')).toBeHidden();
});

test('Stems comes in blank, and a song opened replaces the one shown (RJ, 14 Nov)', async ({ page, request }) => {
  await laySong(request);
  await open(page);
  // Nothing restored: a split song exists, but the page waits for a pick.
  await expect(page.locator('#stSongName')).toHaveText('THE SONG');
  await expect(page.locator('#stLanes .st-lane')).toHaveCount(0);
  await expect(page.locator('#stMixEmpty')).toBeVisible();
  await expect(page.locator('#stWhat')).toBeHidden();
  // An earlier split, opened from the list...
  await page.locator('#stList .st-it', { hasText: 'Test Song' }).click();
  await expect(page.locator('#stSongName')).toHaveText('TEST SONG');
  // ...is replaced by a file opened from the computer: its name, empty lanes waiting.
  const st = await (await request.get('/api/state')).json();
  await page.setInputFiles('#stFile', join(st.library, 'kit', 'tone.wav'));
  await expect(page.locator('#stSongName')).toHaveText('TONE.WAV', { timeout: 15_000 });
  await expect(page.locator('#stLanes .st-lane.st-wait')).toHaveCount(4);
  await expect(page.locator('#stSongMeta')).toContainText('not split yet');
  await expect(page.locator('#stGo')).toHaveText('Split');
});

test('on Stems, a double-click in the library drawer loads the song there, not in Edit (RJ, 14 Nov)', async ({ page, request }) => {
  const st = await (await request.get('/api/state')).json();
  mkdirSync(join(st.library, 'songs'), { recursive: true });
  wav(join(st.library, 'songs', 'Dub Test.wav'), 4, (t) => Math.sin(2 * Math.PI * 110 * t) * 0.3);
  await request.post('/api/scan', { data: {} });
  await expect.poll(async () => (await (await request.get('/api/files?folder=songs')).json()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await open(page);
  await page.click('#stChoose');
  await page.locator('#leftPanel').getByText('songs', { exact: true }).first().click();
  await page.locator('#leftPanel').getByText('Dub Test').first().dblclick();
  await expect(page.locator('#stSongName')).toHaveText('DUB TEST.WAV');
  await expect(page.locator('#stLanes .st-lane.st-wait')).toHaveCount(4);
  expect(await page.evaluate(() => ({ mode: state.mode, drawer: state.drawerOpen }))).toEqual({ mode: 'stems', drawer: false });
  // Anywhere else, a double-click still opens the sound in Edit.
  await page.click('#leftRail .rl-item[data-mode="overview"]');
  await page.locator('#leftPanel').getByText('Dub Test').first().dblclick();
  await expect.poll(() => page.evaluate(() => state.mode)).toBe('edit');
});

test('whatever is picked last stays shown: no snapping back to the library selection (RJ, 14 Nov)', async ({ page, request }) => {
  await laySong(request);
  const st = await (await request.get('/api/state')).json();
  mkdirSync(join(st.library, 'songs'), { recursive: true });
  wav(join(st.library, 'songs', 'Electro Test.wav'), 3, (t) => Math.sin(2 * Math.PI * 220 * t) * 0.3);
  await request.post('/api/scan', { data: {} });
  await expect.poll(async () => (await (await request.get('/api/files?folder=songs')).json()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await open(page);
  await page.click('#stChoose');
  await page.locator('#leftPanel').getByText('songs', { exact: true }).first().click();
  await page.locator('#leftPanel').getByText('Electro Test').first().click();
  await expect(page.locator('#stSongName')).toHaveText('ELECTRO TEST.WAV');
  await page.click('#scrim'); // shut the drawer, as a click outside it does
  await page.waitForTimeout(1000);
  await expect(page.locator('#stSongName')).toHaveText('ELECTRO TEST.WAV');
  // An earlier split, clicked after: it shows, and is still there seconds later.
  await page.locator('#stList .st-it', { hasText: 'Test Song' }).click();
  await expect(page.locator('#stSongName')).toHaveText('TEST SONG');
  await page.waitForTimeout(2000);
  await expect(page.locator('#stSongName')).toHaveText('TEST SONG');
  await expect(page.locator('#stLanes .st-lane:not(.st-wait)')).toHaveCount(4);
  await expect(page.locator('#stSrcName')).toHaveText('Test Song');
});

test('the split status says which stems have come back, and how far the others are', async ({ request }) => {
  const s = await (await request.get('/api/stems')).json();
  expect(Array.isArray(s.arrived)).toBe(true);
  expect(typeof s.incoming).toBe('object');
});

test('Make from my sounds: picks from the drawer, Variations, and only with a GPU machine', async ({ page, request }) => {
  const st = await (await request.get('/api/state')).json();
  const status = await (await request.get('/api/stems')).json();
  mkdirSync(join(st.library, 'sounds'), { recursive: true });
  wav(join(st.library, 'sounds', 'Pick Kick.wav'), 0.5, (t) => Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) * Math.exp(-t * 8));
  wav(join(st.library, 'sounds', 'Pick Rim.wav'), 0.3, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 40));
  await request.post('/api/scan', { data: {} });
  await expect.poll(async () => (await (await request.get('/api/files?folder=sounds')).json()).length, { timeout: 15_000 }).toBe(2);
  await open(page);
  await page.locator('#stTabs [role="radio"]', { hasText: 'Make a sound' }).click();
  await page.locator('#stStart [role="radio"]', { hasText: 'My sounds' }).click();
  await expect(page.locator('#stAlgos .st-algo.on')).toHaveText(/VARIATIONS/);
  await expect(page.locator('#stModels .st-model.on')).toContainText('Stable Audio Open Small');
  // Picks come from the library drawer, and stay on the Make tab.
  await page.click('#stAddPick');
  await page.locator('#leftPanel').getByText('sounds', { exact: true }).first().click();
  await page.locator('#leftPanel').getByText('Pick Kick').first().click();
  await page.locator('#leftPanel').getByText('Pick Rim').first().dblclick();
  await expect(page.locator('#stPicks .st-pickc[data-i]')).toHaveCount(2);
  expect(await page.evaluate(() => ({ mode: state.mode, tab: ST.tab, of: ST.vary.of }))).toEqual({ mode: 'stems', tab: 'make', of: 1 });
  await page.locator('#stPicks .st-pickc', { hasText: 'Pick Kick' }).click();
  await expect(page.locator('#stVaryOf')).toHaveText('A');
  if (status.gpu) {
    await expect(page.locator('#stMakeGo')).toBeEnabled();
  } else {
    await expect(page.locator('#stMakeGo')).toBeDisabled();
    const r = await request.post('/api/stems/vary', { data: { p: 'sounds/Pick Kick.wav' } });
    expect(r.status()).toBe(503);
  }
  // × takes a pick off.
  await page.locator('#stPicks .st-pickc', { hasText: 'Pick Rim' }).locator('[data-x]').click();
  await expect(page.locator('#stPicks .st-pickc[data-i]')).toHaveCount(1);
});
