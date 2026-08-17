// A machine with no audio output.
//
// The server opens the device lazily, so a box without one answers every engine
// route with 503. The interface used to keep asking anyway: switching engines
// put seven failed requests in the console, and the transport looked live while
// doing nothing. CI found it on its first green build — every machine this had
// ever run on had a sound card.
//
// The rule this pins: **browsing, editing, tagging and exporting do not need a
// device, and only playback does.** So the interface asks once, says so where
// the transport is, and stops asking.
//
// The device is simulated rather than removed, because the machine running these
// almost certainly has one. That is the point — the real case is unreachable
// here and was therefore never tested.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  // Bare `state`: it is a `const` at classic-script top level, so it is a
  // lexical global and never a property of `window`.
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 15_000 },
  );
}

async function openFirstSound(page) {
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForFunction(() => Object.keys(state.grainRows || {}).length > 0,
    { timeout: 20_000 });
}

/// Tell the interface there is no device, the way `checkAudioDevice` would.
async function pretendNoDevice(page) {
  await page.evaluate(() => {
    engine.device = false;
    engine.deviceError = 'no audio device';
    reflectAudioDevice();
  });
}

/// The route that has to answer either way, because the interface polls it.
test('engine state answers, and says whether there is a device', async ({ page }) => {
  await ready(page);
  const s = await page.evaluate(() => api('/api/engine/state'));
  expect(typeof s.playing, 'no playing flag').toBe('boolean');
  expect(typeof s.device, `no device flag in ${JSON.stringify(s)}`).toBe('boolean');
});

/// With no device, nothing asks the engine to do anything.
///
/// This is the actual regression. Switching engines fired a transport request
/// each time, and each one came back 503 and landed in the console.
test('with no audio device, the interface stops asking the engine', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);
  await pretendNoDevice(page);

  const asked = [];
  page.on('request', (r) => {
    const u = new URL(r.url()).pathname;
    // `/api/engine/state` is allowed: it is the one that answers without a
    // device, and it is how the interface learned there isn't one.
    if (u.startsWith('/api/engine/') && u !== '/api/engine/state') asked.push(u);
  });

  const engines = await page.evaluate(() =>
    [...document.querySelectorAll('#stretchEngine .seg-btn')].map((b) => b.dataset.alg));
  for (const alg of engines) {
    await page.evaluate((a) => {
      document.querySelector(`#stretchEngine .seg-btn[data-alg="${a}"]`).click();
    }, alg);
    await page.waitForTimeout(200);
  }
  // And the transport, which is the most obvious thing to reach for.
  await page.evaluate(() => { $('playBtn').click(); });
  await page.waitForTimeout(400);

  expect(asked, `the engine was asked ${asked.length} times with no device to serve it`)
    .toEqual([]);
  expect(await page.evaluate(() => engine.playing), 'it thinks it is playing').toBe(false);
});

/// And it says so, rather than looking live and doing nothing silently.
test('with no audio device, the transport says why', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);

  // The "before" depends on the machine, and assuming it does not is the exact
  // mistake this file exists about: written as an unconditional "the warning is
  // hidden", it passed on the developer's Mac and failed on CI, where there
  // really is no device and the warning was correctly showing.
  const hasDevice = await page.evaluate(() => engine.device !== false);
  if (hasDevice) {
    expect(await page.evaluate(() => $('noAudio').classList.contains('hidden')),
      'a machine with audio is being warned it has none').toBe(true);
    expect(await page.evaluate(() => $('playBtn').disabled),
      'a machine with audio has its transport switched off').toBe(false);
  } else {
    expect(await page.evaluate(() => $('noAudio').classList.contains('hidden')),
      'this machine has no device and nothing said so').toBe(false);
  }

  await pretendNoDevice(page);

  expect(await page.evaluate(() => $('noAudio').classList.contains('hidden')),
    'no device, and nothing said so').toBe(false);
  for (const id of ['playBtn', 'stopBtn', 'loopBtn', 'recBtn']) {
    expect(await page.evaluate((x) => $(x).disabled, id),
      `${id} is still live with no device behind it`).toBe(true);
  }
});

/// Everything that does not need a device still works.
///
/// The failure mode to guard against is over-correcting: disabling the audio
/// path is right, disabling the program is not.
test('with no audio device, editing and exporting still work', async ({ page }) => {
  await ready(page);
  await openFirstSound(page);
  await pretendNoDevice(page);

  // An edit reaches the document.
  const ratio = await page.evaluate(async () => {
    await editOp({ op: 'stretch', ...state.stretchDraft, ratio: 1.5 });
    await new Promise((r) => setTimeout(r, 1200));
    return state.edit?.stretch?.ratio;
  });
  expect(ratio, 'an edit did not apply without a device').toBeCloseTo(1.5, 3);

  // And the waveform is still drawn, so the interface is not merely inert.
  const lit = await page.evaluate(() => {
    const cv = document.getElementById('waveCanvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  });
  expect(lit, 'nothing is drawn on the waveform').toBeGreaterThan(1000);

  // The export runs to completion and writes a file.
  const out = await page.evaluate(async () => {
    await postJSON('/api/export', { p: state.selectedFile.path, bits: 16 });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const s = await api('/api/export');
      if (!s.running) return { path: s.path, frames: s.frames, error: s.error };
    }
    return { error: 'the export never finished' };
  });
  expect(out.error || '', 'the export failed without a device').toBe('');
  expect(out.frames, 'the export wrote no frames').toBeGreaterThan(0);
});
