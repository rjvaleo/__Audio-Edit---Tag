// The synths' keys and MIDI channels (`ui/sequencer/keys.js`, `midi.rs`).
//
// - Atmosphere has a key strip, held for as long as a key is down;
// - Atmosphere is on MIDI 3 and Classic on 4 until changed, kept in this
//   browser and sent to the server;
// - a note on a part's channel plays that part and no other;
// - a synth that is off is silent to its keys and to MIDI.
//
// MIDI is played with `/api/engine/midi/inject`, the server's way in for a
// test: the same routing a keyboard's message takes.

import { test, expect } from './test.mjs';

async function openSeq(page) {
  await page.goto('/sequencer/');
  await page.waitForFunction(() => typeof keysInit === 'function' && !!document.getElementById('kyStrip') && KY.n !== null);
  await page.evaluate(() => { try { localStorage.removeItem('midiChannel.atmos'); localStorage.removeItem('midiChannel.classic'); } catch {} });
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
  const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
  await page.mouse.down();
  expect(await held(page)).toEqual(['atmos:60']);
  await expect(key).toHaveClass(/\bon\b/);
  await page.mouse.up();
  expect(await held(page)).toEqual([]);
  // Off is silent.
  await mode(page, 'classic');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
  await page.mouse.down();
  expect(await held(page)).toEqual([]);
  await page.mouse.up();
});

test('MIDI plays each synth on its own channel, and not while it is off', async ({ page }) => {
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
  // Off mutes MIDI too.
  await mode(page, 'classic');
  await inject(page, [0x92, 67, 100]);
  await inject(page, [0x93, 69, 100]);
  await expect.poll(() => held(page)).toEqual(['classic:69']);
  await inject(page, [0xb3, 123, 0]); // all notes off
  await expect.poll(() => held(page)).toEqual([]);
});
