// Recalling a preset with its sound must draw that sound.
//
// Reported as "when recalling a preset the audio waveform isn't shown and there
// is no playhead yet everything plays" — which is a precise symptom. Audio and
// picture come from different places: the engine is loaded *by path* and plays
// happily, while the lane needs the file's *record* — its sample rate above all,
// because `selectFile` builds `state.view` from it.
//
// `fileFromPath` only searched folders that were already open, and otherwise
// invented a stub with a path and a name and nothing else. So a preset whose
// sound lived in an unexpanded folder opened with a zero-length view, never
// fetched peaks, and `updatePlayhead` hid the playhead because there were none.

import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
}

test('a preset recalled with its sound draws that sound', async ({ page }) => {
  await ready(page);

  const setup = await page.evaluate(async () => {
    const presets = (await api('/api/presets')).presets || [];
    // One that carries a sound, and whose sound is in a folder we have not
    // opened — the case that was broken.
    const withPath = presets.find((p) => p.path);
    if (!withPath) return { skip: 'no preset carries a sound' };
    const folder = state.folders[0];
    const files = await api(`/api/files?folder=${encodeURIComponent(folder.name)}`);
    const other = files.find((f) => f.path !== withPath.path);
    if (!other) return { skip: 'nothing else to open first' };
    await selectFile(other);
    setMode('edit');
    return { name: withPath.name, target: withPath.path, from: other.path };
  });
  if (setup.skip) test.skip(true, setup.skip);

  await page.waitForFunction(() => !!state.peaks, { timeout: 20_000 });

  const out = await page.evaluate(async (s) => {
    // Forget every folder listing, so the preset's sound cannot be found in one
    // — exactly the state a fresh session is in.
    state.folderFiles = {};
    document.getElementById('presetWithSound').checked = true;
    $('presetPick').value = s.name;
    $('presetPick').dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 6000));
    document.getElementById('presetWithSound').checked = false;
    return {
      open: state.selectedFile?.path,
      sampleRate: state.selectedFile?.sampleRate,
      peaks: !!state.peaks,
      frames: state.view?.frames,
      span: state.view ? state.view.to - state.view.from : 0,
    };
  }, setup);

  expect(out.open, 'the preset did not open its own sound').toBe(setup.target);
  expect(out.sampleRate, 'the file record has no sample rate — it is a stub')
    .toBeGreaterThan(0);
  expect(out.frames, 'the view has no length, so nothing can be drawn')
    .toBeGreaterThan(0);
  expect(out.peaks, 'no peaks were fetched, so the lane is empty').toBe(true);
  // The three things `updatePlayhead` needs before it will show the playhead.
  expect(out.span, 'the view is empty, so the playhead stays hidden')
    .toBeGreaterThan(0);
});
