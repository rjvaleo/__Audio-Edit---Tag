// The synths' keys and MIDI channels (`ui/sequencer/keys.js`, `midi.rs`).
//
// - Atmosphere has a key strip, held for as long as a key is down;
// - Atmosphere is on MIDI 3 and Classic on 4 until changed, kept in this
//   browser and sent to the server;
// - a note on a part's channel plays that part and no other;
// - Atmosphere is its own instrument: its keys and MIDI play it whether or
//   not the sequencer does; Classic, off, is silent to MIDI.
//
// MIDI is played with `/api/engine/midi/inject`, the server's way in for a
// test: the same routing a keyboard's message takes.

import { test, expect } from './test.mjs';

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof keysInit === 'function' && !!document.getElementById('kyStrip') && KY.n !== null);
  await page.evaluate(() => { try { localStorage.removeItem('midiChannel.atmos'); localStorage.removeItem('midiChannel.classic'); } catch {} });
  // The keys are on the Atmosphere page (RJ, 16 Nov: Seq is the sequencer as it was).
  await page.evaluate(() => document.body.classList.add('only-atmos'));
}

const held = (page) => page.evaluate(() => [...KY.held.keys()].sort());
const mode = (page, m) => page.evaluate((m) => atmosSet('atModeSelect', m), m);
const inject = (page, msg) => page.request.post('/api/engine/midi/inject', { data: { msg } });

test('Atmosphere is on MIDI 3 and Classic on 4, and a change is kept and sent', async ({ page }) => {
  await openSeq(page);
  await mode(page, 'both'); // Atmosphere's panel shows while it is on
  await page.evaluate(() => kySendChannels());
  expect(await page.locator('#kyMidi_atmos').inputValue()).toBe('3');
  expect(await page.locator('#kyMidi_classic').inputValue()).toBe('4');
  let m = await (await page.request.get('/api/engine/midi')).json();
  expect([m.atmos, m.classic, m.bass, m.drums]).toEqual([3, 4, 5, 10]);
  await page.locator('#kyMidi_atmos').selectOption('7');
  await expect.poll(async () => (await (await page.request.get('/api/engine/midi')).json()).atmos).toBe(7);
  expect(await page.evaluate(() => localStorage.getItem('midiChannel.atmos'))).toBe('7');
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('kyMidi_atmos'));
  expect(await page.locator('#kyMidi_atmos').inputValue()).toBe('7');
  await page.evaluate(() => { localStorage.removeItem('midiChannel.atmos'); return kySendChannels(); });
});

test('a key on the strip sounds Atmosphere for as long as it is held', async ({ page }) => {
  await openSeq(page);
  await mode(page, 'atmos');
  const key = page.locator('.ky-key[data-k="60"]');
  await key.scrollIntoViewIfNeeded();
  const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
  await page.mouse.down();
  expect(await held(page)).toEqual(['atmos:60']);
  await expect(key).toHaveClass(/\bon\b/);
  await page.mouse.up();
  expect(await held(page)).toEqual([]);
  // Its own instrument: the sequencer not playing it does not silence its keys.
  await mode(page, 'classic');
  await page.evaluate(() => { document.body.classList.add('only-atmos'); });
  await key.scrollIntoViewIfNeeded();
  const b2 = await key.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height - 4);
  await page.mouse.down();
  expect(await held(page)).toEqual(['atmos:60']);
  await page.mouse.up();
  expect(await held(page)).toEqual([]);
});

test('MIDI plays each synth on its own channel; Atmosphere always, Classic only while on', async ({ page }) => {
  await openSeq(page);
  await page.evaluate(() => kySendChannels());
  await mode(page, 'both');
  await inject(page, [0x92, 62, 100]); // channel 3: Atmosphere
  await expect.poll(() => held(page)).toEqual(['atmos:62']);
  await inject(page, [0x93, 64, 100]); // channel 4: Classic
  await expect.poll(() => held(page)).toEqual(['atmos:62', 'classic:64']);
  await inject(page, [0x91, 65, 100]); // channel 2 is Grain's: nothing here
  await inject(page, [0x82, 62, 0]);
  await inject(page, [0x83, 64, 0]);
  await expect.poll(() => held(page)).toEqual([]);
  // Atmosphere plays from MIDI whether or not the sequencer uses it;
  // Classic, off, does not.
  await mode(page, 'classic');
  await inject(page, [0x92, 67, 100]);
  await inject(page, [0x93, 69, 100]);
  await expect.poll(() => held(page)).toEqual(['atmos:67', 'classic:69']);
  await mode(page, 'atmos');
  await inject(page, [0x93, 71, 100]);
  await inject(page, [0x92, 72, 100]);
  await expect.poll(() => held(page)).toEqual(['atmos:67', 'atmos:72', 'classic:69']);
  await inject(page, [0xb3, 123, 0]); // all notes off, on each one's channel
  await inject(page, [0xb2, 123, 0]);
  await expect.poll(() => held(page)).toEqual([]);
});

test('a fresh Atmosphere sounds from a key, with nothing set up and nothing turned on', async ({ page }) => {
  await openSeq(page);
  const r = await page.evaluate(async () => {
    const kinds = [AT.kindA, AT.kindB];
    const Real = window.AudioContext, rate = 48000;
    const off = new OfflineAudioContext(2, rate, rate);
    off.createMediaStreamDestination = () => off.createGain();
    window.AudioContext = function () { return off; };
    audioCtx = null;
    try { initAudio(); } finally { window.AudioContext = Real; }
    const was = atmosOn;
    const v = kyAtmosOn(kyHz(60), 0.8);
    const buf = await off.startRendering();
    audioCtx = null;
    const x = buf.getChannelData(0);
    let s = 0;
    for (let i = rate / 2; i < x.length; i++) s += x[i] * x[i];
    return { kinds, was, voice: !!v, rms: Math.sqrt(s / (x.length / 2)) };
  });
  expect(r.was).toBe(false); // the sequencer is not playing it
  expect(r.kinds.every(Boolean)).toBe(true);
  expect(r.voice).toBe(true);
  expect(r.rms).toBeGreaterThan(0.001);
});
