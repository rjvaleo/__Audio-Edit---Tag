// The Stems page's MIDI tab (RJ, 18 Nov 2026: "Stems to MIDI").
//
// A split song's drums, bass and chords, as the analysis read them, drawn over
// the song and written as a Standard MIDI File beside the stems.
//
// Nothing is split or analysed here: the test lays a song's folder into the
// scratch library's `Stems/` with a small `songprint.json`, which is what a
// split and its reading leave, and proves the tab and the file from there. The
// file's bytes are proved note by note in Rust (`songprint::midi`).

import { test, expect } from './test.mjs';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SONG = 'Midi Song';

/// A 16-bit mono WAV at 8 kHz from a function of time; silence by default (a
/// second of it: the page draws a lane for each stem).
function quiet(path, seconds = 1, f = null) {
  const n = Math.round(8000 * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  if (f) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f(i / 8000))) * 30000), 44 + i * 2);
  writeFileSync(path, b);
}

/// A voice on A above middle C for the first two beats of bar 1 (the bar starts
/// half a second in), with a second harmonic as a voice has; then nothing.
const sung = (t) => (t >= 0.5 && t < 1.5 ? 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 880 * t) : 0);

/// Four bars at 120: a kick on every beat, a snare on 2 and 4, hats between;
/// two bass notes a bar; F major seventh for two bars, then D minor.
function analysis() {
  const row = (at, v = 1) => Array.from({ length: 16 }, (_, i) => (at.includes(i) ? v : 0));
  const bars = [0, 1, 2, 3].map((bar) => ({ bar, t: 0.5 + bar * 2, kick: row([0, 4, 8, 12]), snare: row([4, 12]), hat: row([2, 6, 10, 14], 0.5), chord: bar < 2 ? 'Fmaj7' : 'Dm' }));
  return {
    format: 'songprint/1', title: SONG, duration_s: 9,
    tempo: { bpm: 120, confidence: 1, map: [] }, key: { name: 'F major', regions: [[0, 'F major', 1]] },
    // What the Split tab reads of it, as a real reading has it.
    drums: { swing_8th_pct: 50, bar_families: 1, common_bars: [] }, change: { section_bars_median: 2, entries_exits_per_minute: 0 },
    // The first beat half a second in; bar 0 starts on it.
    beats_s: Array.from({ length: 18 }, (_, i) => 0.5 + i * 0.5), downbeat_beat: 0, bar_count: 4,
    bars,
    bass: { notes: [0, 1, 2, 3].flatMap((bar) => [[bar, 0, 4, 29.4, 1], [bar, 8, 2, 33.1, 0.6]]) },
    chords: { changes: [[0, 'Fmaj7'], [2, 'Dm']] },
    sections: [{ label: 'A', start_bar: 0, bars: 2, start_s: 0.5, end_s: 4.5, stems_on: ['drums', 'bass'] }, { label: 'B', start_bar: 2, bars: 2, start_s: 4.5, end_s: 8.5, stems_on: ['drums', 'bass'] }],
  };
}

async function laySong(request) {
  const st = await (await request.get('/api/state')).json();
  const dir = join(st.library, 'Stems', SONG);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const s of ['drums', 'bass', 'other']) quiet(join(dir, `${s}.wav`));
  quiet(join(dir, 'vocals.wav'), 9, sung);
  writeFileSync(join(dir, 'stems.json'), JSON.stringify({ source: 'kit/tone.wav', model: 'htdemucs', splitSeconds: 1 }));
  writeFileSync(join(dir, 'songprint.json'), JSON.stringify(analysis()));
  return dir;
}

/// The Stems page, on its MIDI tab, with the song picked there.
async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof stEnter === 'function', null, { timeout: 20_000 });
  await page.click('#leftRail .rl-item[data-mode="stems"]');
  await page.waitForFunction(() => document.body.classList.contains('stemspage'));
  await page.locator('#stTabs [role="radio"]', { hasText: 'MIDI' }).click();
  await expect(page.locator('#stMidi')).toBeVisible();
  await page.locator('#smSong').selectOption({ label: SONG });
  await expect(page.locator('#smFacts')).toHaveText('120.0 bpm · F major · 4 bars');
}

/// A MIDI file's header and its tracks: each one's name, note-ons and tempo changes.
function readMidi(buf) {
  expect(buf.toString('latin1', 0, 4)).toBe('MThd');
  const out = { format: buf.readUInt16BE(8), said: buf.readUInt16BE(10), ppq: buf.readUInt16BE(12), tracks: [] };
  let o = 14;
  while (o < buf.length) {
    expect(buf.toString('latin1', o, o + 4)).toBe('MTrk');
    const len = buf.readUInt32BE(o + 4), t = buf.subarray(o + 8, o + 8 + len);
    const tr = { name: '', ons: [], tempos: 0 };
    let i = 0, tick = 0;
    const vlq = () => { let v = 0; for (;;) { const c = t[i++]; v = (v << 7) | (c & 127); if (!(c & 128)) return v; } };
    while (i < len) {
      tick += vlq();
      const s = t[i++];
      if (s === 0xff) {
        const kind = t[i++], l = vlq(), d = t.subarray(i, i + l); i += l;
        if (kind === 3) tr.name = d.toString('utf8');
        if (kind === 0x51) tr.tempos++;
      } else {
        if ((s & 0xf0) === 0x90) tr.ons.push({ tick, ch: (s & 15) + 1, note: t[i] });
        i += 2;
      }
    }
    out.tracks.push(tr);
    o += 8 + len;
  }
  expect(o).toBe(buf.length);
  return out;
}

test('the MIDI tab shows the song\'s parts with their notes, and draws them', async ({ page, request }) => {
  await laySong(request);
  await open(page);
  // Sixteen kicks, eight snares, sixteen hats; eight bass notes; Fmaj7 is four notes, Dm three.
  const parts = await page.locator('#smParts .sm-part').evaluateAll((els) => els.map((e) => [e.dataset.part, e.querySelector('.n')?.textContent ?? null]));
  expect(parts).toEqual([['drums', 'ch 1040 notes'], ['bass', 'ch 58 notes'], ['chords', 'ch 67 notes'], ['melody', null], ['other', null]]);
  // The two that are read at a press say so, and are not in the file until they have been.
  await expect(page.locator('#smParts .sm-part[data-part="melody"] button')).toHaveText('Read it');
  await expect(page.locator('#smParts .sm-part[data-part="melody"] input')).toBeDisabled();
  // Other notes is read on the PC, and the scratch server has none.
  await expect(page.locator('#smParts .sm-part[data-part="other"] button')).toBeDisabled();
  await expect(page.locator('#smSpan')).toHaveText('bars 1 to 4');
  // Something is inked in the pitched area and in the drum rows.
  const inked = await page.evaluate(() => {
    const c = document.getElementById('smRoll'), g = c.getContext('2d'), k = c.width / 846;
    const any = (y0, y1) => { const d = g.getImageData(0, Math.round(y0 * k), c.width, Math.round((y1 - y0) * k)).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; };
    return { notes: any(60, 400), drums: any(430, 495) };
  });
  expect(inked).toEqual({ notes: true, drums: true });
  // One fixed size, and the scale's font sizes only.
  const size = await page.evaluate(() => {
    const r = document.querySelector('.sm-page').getBoundingClientRect(), c = document.getElementById('smRoll').getBoundingClientRect();
    return { w: r.width, roll: [c.width, c.height], fonts: [...new Set([...document.querySelectorAll('.sm-page *')].filter((e) => e.textContent.trim() && e.tagName !== 'OPTION').map((e) => getComputedStyle(e).fontSize))].sort() };
  });
  expect(size.w).toBe(1496);
  expect(size.roll).toEqual([846, 500]);
  for (const f of size.fonts) expect(['9px', '10px', '11px', '13px', '16px']).toContain(f);
});

test('Write puts a MIDI file beside the stems, a track a part on its own channel', async ({ page, request }) => {
  const dir = await laySong(request);
  await open(page);
  await expect(page.locator('#smDone')).toBeHidden();
  await page.locator('#smWrite').click();
  await expect(page.locator('#smDone')).toContainText('Written: 3 tracks, 55 notes');
  await expect(page.locator('#smDone .sm-path')).toHaveText(`Stems/${SONG}/${SONG}.mid`);
  const file = join(dir, `${SONG}.mid`);
  expect(existsSync(file)).toBe(true);
  const m = readMidi(readFileSync(file));
  expect([m.format, m.said, m.ppq]).toEqual([1, 4, 480]);
  expect(m.tracks.map((t) => t.name)).toEqual([SONG, 'Drums', 'Bass', 'Chords']);
  expect(m.tracks.map((t) => t.ons.length)).toEqual([0, 40, 8, 7]);
  expect([...new Set(m.tracks[1].ons.map((n) => n.ch))]).toEqual([10]);
  expect([...new Set(m.tracks[2].ons.map((n) => n.ch))]).toEqual([5]);
  expect([...new Set(m.tracks[3].ons.map((n) => n.ch))]).toEqual([6]);
  // On the grid: one tempo, and the bass's second note of bar 0 on step 8 (two beats in), written as A1.
  expect(m.tracks[0].tempos).toBe(1);
  expect(m.tracks[2].ons.slice(0, 2)).toEqual([{ tick: 0, ch: 5, note: 29 }, { tick: 960, ch: 5, note: 33 }]);
  // Download is that file.
  const got = await request.get(`/api/stems/midi?p=${encodeURIComponent(`Stems/${SONG}`)}`);
  expect(got.headers()['content-type']).toBe('audio/midi');
  expect(Buffer.compare(await got.body(), readFileSync(file))).toBe(0);
});

test('the choices reach the file, and changing one takes the Written note away', async ({ page, request }) => {
  const dir = await laySong(request);
  await open(page);
  await page.locator('#smWrite').click();
  await expect(page.locator('#smDone')).toBeVisible();
  // Chords off: the note about the old file goes, and the next file has no chord track.
  await page.locator('#smParts input[data-k="chords"]').uncheck();
  await expect(page.locator('#smDone')).toBeHidden();
  await expect(page.locator('#smParts .sm-part[data-part="chords"]')).toHaveClass(/\boff\b/);
  await page.locator('#smTiming [role="radio"]', { hasText: 'As the song plays' }).click();
  await page.locator('#smBass [role="radio"]', { hasText: 'An octave up' }).click();
  await page.locator('#smWrite').click();
  await expect(page.locator('#smDone')).toContainText('Written: 2 tracks, 48 notes');
  const m = readMidi(readFileSync(join(dir, `${SONG}.mid`)));
  expect(m.tracks.map((t) => t.name)).toEqual([SONG, 'Drums', 'Bass']);
  // As the song plays: a tempo for the lead-in and one for every beat after it.
  expect(m.tracks[0].tempos).toBe(18);
  // The lead-in is one beat long, so bar 0 starts at tick 480; the bass is an octave up.
  expect(m.tracks[2].ons[0]).toEqual({ tick: 480, ch: 5, note: 41 });
  // With nothing ticked there is nothing to write.
  await page.locator('#smParts input[data-k="drums"]').uncheck();
  await page.locator('#smParts input[data-k="bass"]').uncheck();
  await expect(page.locator('#smWrite')).toBeDisabled();
});

test('a click on a section looks closer, and Whole song goes back', async ({ page, request }) => {
  await laySong(request);
  await open(page);
  await expect(page.locator('#smWhole')).toBeDisabled();
  const box = await page.locator('#smRoll').boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + 10);
  await expect(page.locator('#smSpan')).toHaveText('bars 3 to 4');
  await page.locator('#smWhole').click();
  await expect(page.locator('#smSpan')).toHaveText('bars 1 to 4');
  await expect(page.locator('#smWhole')).toBeDisabled();
});

test('a song that has not been read says so, and cannot be written', async ({ page, request }) => {
  const dir = await laySong(request);
  rmSync(join(dir, 'songprint.json'));
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof stEnter === 'function', null, { timeout: 20_000 });
  await page.click('#leftRail .rl-item[data-mode="stems"]');
  await page.locator('#stTabs [role="radio"]', { hasText: 'MIDI' }).click();
  await expect(page.locator('#smFacts')).toHaveText('Split a song first, on Split a song.');
  await page.locator('#smSong').selectOption({ label: SONG });
  await expect(page.locator('#smFacts')).toHaveText(/has not been read yet/);
  await expect(page.locator('#smWrite')).toBeDisabled();
  const r = await request.post('/api/stems/midi', { data: { p: `Stems/${SONG}` } });
  expect(r.status()).toBe(400);
});

test('Read it finds the melody in the vocals stem, and it goes into the file on channel 7', async ({ page, request }) => {
  const dir = await laySong(request);
  await open(page);
  await page.locator('#smParts .sm-part[data-part="melody"] button').click();
  // The voice holds one note for two beats: one note, eight sixteenths long.
  await expect(page.locator('#smParts .sm-part[data-part="melody"] .n')).toHaveText('ch 71 notes', { timeout: 20_000 });
  await expect(page.locator('#smParts .sm-part[data-part="melody"] input')).toBeChecked();
  const kept = JSON.parse(readFileSync(join(dir, 'notes-melody.json'), 'utf8'));
  expect(kept.notes).toEqual([[0, 0, 8, 69, 1]]);
  await page.locator('#smWrite').click();
  await expect(page.locator('#smDone')).toContainText('Written: 4 tracks, 56 notes');
  const m = readMidi(readFileSync(join(dir, `${SONG}.mid`)));
  expect(m.tracks.map((t) => t.name)).toEqual([SONG, 'Drums', 'Bass', 'Chords', 'Melody']);
  expect(m.tracks[4].ons).toEqual([{ tick: 0, ch: 7, note: 69 }]);
  // It is kept: the song opened again has its melody without reading it again.
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof stEnter === 'function', null, { timeout: 20_000 });
  await page.click('#leftRail .rl-item[data-mode="stems"]');
  await page.locator('#stTabs [role="radio"]', { hasText: 'MIDI' }).click();
  await page.locator('#smSong').selectOption({ label: SONG });
  await expect(page.locator('#smParts .sm-part[data-part="melody"] .n')).toHaveText('ch 71 notes');
});

test('Other notes is read on the PC at a press, and goes into the file on channel 8', async ({ page, request }) => {
  const dir = await laySong(request);
  // The PC's part, answered here: Basic Pitch found a C major chord on bar 2.
  const found = [[1, 0, 4, 60, 1], [1, 0, 4, 64, 0.8], [1, 0, 4, 67, 0.6]];
  let asked = null;
  await page.route('**/api/stems/notes**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { melody: null, other: null, gpu: true } });
    asked = JSON.parse(req.postData());
    // What the server does on the way back: it keeps them beside the stems.
    writeFileSync(join(dir, 'notes-other.json'), JSON.stringify({ part: 'other', notes: found }));
    await route.fulfill({ json: { part: 'other', notes: found } });
  });
  await open(page);
  const row = page.locator('#smParts .sm-part[data-part="other"]');
  await expect(row.locator('button')).toHaveText('Read it on the PC');
  await expect(row.locator('button')).toBeEnabled();
  await row.locator('button').click();
  await expect(row.locator('.n')).toHaveText('ch 83 notes');
  expect(asked).toEqual({ p: `Stems/${SONG}`, part: 'other' });
  await page.locator('#smWrite').click();
  await expect(page.locator('#smDone')).toContainText('Written: 4 tracks, 58 notes');
  const m = readMidi(readFileSync(join(dir, `${SONG}.mid`)));
  expect(m.tracks.map((t) => t.name)).toEqual([SONG, 'Drums', 'Bass', 'Chords', 'Other notes']);
  expect(m.tracks[4].ons).toEqual([{ tick: 1920, ch: 8, note: 60 }, { tick: 1920, ch: 8, note: 64 }, { tick: 1920, ch: 8, note: 67 }]);
});
