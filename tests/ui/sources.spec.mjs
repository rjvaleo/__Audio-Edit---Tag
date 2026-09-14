// The two sound generators, and which of them play.
//
// GRAIN and SEQ are switches on the transport. A source switched off is
// silent, out of the picture, and out of an export. Before this the sequencer
// played on every Play once it had ever been opened, and there was no way to
// hear one without the other.

import { test, expect } from '@playwright/test';

async function openFile(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForSelector('#transportBar', { state: 'visible', timeout: 20_000 });
}

test('both sources are on the transport, on by default, and a switch is kept', async ({ page }) => {
  await openFile(page);
  const before = await page.evaluate(() => ({
    grain: $('srcGrain').classList.contains('on'), seq: $('srcSeq').classList.contains('on'),
    state: { ...state.sources },
  }));
  expect(before.grain).toBe(true);
  expect(before.seq).toBe(true);
  await page.click('#srcSeq');
  const off = await page.evaluate(() => ({
    seq: $('srcSeq').classList.contains('on'), state: state.sources.seq,
    saved: JSON.parse(localStorage.getItem('audiolab.sources.v1') || '{}').seq,
  }));
  expect(off.seq).toBe(false);
  expect(off.state).toBe(false);
  expect(off.saved, 'the switch was not kept').toBe(false);
  await page.reload();
  await openFile(page);
  expect(await page.evaluate(() => sourceOn('seq'))).toBe(false);
  await page.evaluate(() => setSource('seq', true));
});

test('SEQ off stops the sequencer being synced or mixed; GRAIN off mutes the engine and drops its feed', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate(() => {
    const posts = [], engine_ = [];
    const realPost = seqPost, realEngine = enginePost;
    seqPost = (m) => posts.push(m);
    enginePost = async (b) => { engine_.push(b); return null; };
    try {
      // Pretend the sequencer is playing and feeding.
      seq.feed = { rms: 0.5, peak: 0.6, spectrum: [-20, -20], lissajous: [0, 0], rate: 48000 };
      seq.feedAt = performance.now();
      const data = { live: true, spectrum: [-40, -40], lissajous: [0.1, 0.1], lo: 20, hi: 20000 };
      setSource('seq', false);
      seqSync(true);
      const mixedOff = seqMix(data, 2);
      setSource('seq', true);
      seqSync(true);
      // Off dropped the feed, as it should; the sequencer feeds again.
      seq.feed = { rms: 0.5, peak: 0.6, spectrum: [-20, -20], lissajous: [0, 0], rate: 48000 };
      seq.feedAt = performance.now();
      const mixedOn = seqMix(data, 2);
      setSource('grain', false);
      const out = {
        stopSent: posts.some((m) => m.type === 'seq:transport' && m.playing === false),
        playSentWhileOff: posts.filter((m) => m.type === 'seq:transport' && m.playing === true).length,
        sameWhenOff: mixedOff === data,
        mixedWhenOn: mixedOn !== data && mixedOn.seq === true,
        muted: engine_.some((b) => b.mute === true),
      };
      setSource('grain', true);
      out.unmuted = engine_.some((b) => b.mute === false);
      return out;
    } finally {
      seqPost = realPost; enginePost = realEngine; seq.feed = null;
      setSource('seq', true); setSource('grain', true);
    }
  });
  expect(got.stopSent, 'SEQ off did not tell the sequencer to stop').toBe(true);
  expect(got.playSentWhileOff, 'the sequencer was still synced with SEQ on again').toBe(1);
  expect(got.sameWhenOff, 'the feed was mixed with SEQ off').toBe(true);
  expect(got.mixedWhenOn).toBe(true);
  expect(got.muted, 'GRAIN off did not mute the engine').toBe(true);
  expect(got.unmuted, 'GRAIN on did not unmute it').toBe(true);
});

test('an export follows the switches: the sequencer by the SEQ switch, silence by GRAIN off', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate(() => {
    const out = {};
    out.noSeqLoaded = exportWithSeq();
    // Stand in for a loaded sequencer.
    const realLoaded = seqLoaded;
    seqLoaded = () => true;
    try {
      setSource('seq', true);
      out.bySwitchOn = exportWithSeq();
      setSource('seq', false);
      out.bySwitchOff = exportWithSeq();
      // The dialog, open, says otherwise for one export.
      $('exportLoop').classList.remove('hidden');
      $('elSeq').classList.add('on');
      out.byDialog = exportWithSeq();
      $('exportLoop').classList.add('hidden');
      setSource('seq', true);
    } finally { seqLoaded = realLoaded; setSource('seq', true); }
    return out;
  });
  expect(got.noSeqLoaded, 'a sequencer that is not loaded went into an export').toBe(false);
  expect(got.bySwitchOn).toBe(true);
  expect(got.bySwitchOff).toBe(false);
  expect(got.byDialog, 'the dialog did not override the switch').toBe(true);
});
