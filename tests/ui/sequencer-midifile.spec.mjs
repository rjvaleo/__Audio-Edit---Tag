// The Band's MIDI file player (`ui/sequencer/midifile.js` + `/api/seq/midi`):
//
// - stepping `mfAt(k, k * d)` sounds each note once at its time, pitch, length
//   and part; drums pass their velocity straight to `drumHit`;
// - section loop wraps to its first bar; "stop" plays nothing past the end;
// - remapping a track to another part or Nothing, or unticking it, changes who plays;
// - "The file's" tempo sets the Band's; "The Band's" leaves it alone;
// - "The Band's scale" moves notes to the nearest degree of the Band's scale;
// - with the file off, `bandPlan(k)` is identical to before it was turned on;
// - an offline render has sound where notes fall and silence where they do not;
// - state survives a preset save and load;
// - "Open a file…" with real `.mid` bytes shows its name and tracks; a bad file shows an error;
// - fixed sizes (1496 wide, 420/752/308 columns, 520 tall, 730x430 roll) and scale font sizes only.

import { test, expect } from './test.mjs';

/// Sample parsed song JSON in the exact shape returned by `/api/seq/midi`.
function sampleSong() {
  return {
    title: 'Demo Song',
    bpm: 132,
    bars: 4,
    markers: [[0, 'A'], [2, 'B']],
    parts: [
      {
        name: 'Drums',
        channel: 10,
        notes: [
          [0, 0, 0.5, 36, 0.9],
          [0, 4, 0.5, 38, 0.7],
          [2, 0, 0.5, 42, 0.6],
        ],
      },
      {
        name: 'Bass',
        channel: 5,
        notes: [
          [0, 0, 4, 36, 0.85],
          [2, 8, 2, 43, 0.65],
        ],
      },
      {
        name: 'Chords',
        channel: 6,
        notes: [
          [0, 0, 16, 60, 0.7],
          [0, 0, 16, 64, 0.7],
        ],
      },
      {
        name: 'Other notes',
        channel: 8,
        notes: [
          [1, 0, 4, 69, 0.8],
          [3, 4, 4, 71, 0.75],
        ],
      },
    ],
  };
}

/// Build a tiny valid type-1 Standard MIDI File (480 PPQ, 128 bpm, drums + bass tracks).
function makeRealMidiBytes() {
  const vlq = (n) => {
    const out = [n & 0x7f];
    n >>= 7;
    while (n > 0) { out.push((n & 0x7f) | 0x80); n >>= 7; }
    return out.reverse();
  };
  const meta = (k, bytes) => [0xff, k, ...vlq(bytes.length), ...bytes];
  const str = (s) => [...Buffer.from(s, 'utf8')];
  const trk = (events) => {
    const body = [];
    let at = 0;
    for (const [tick, data] of events) {
      body.push(...vlq(tick - at), ...data);
      at = tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    return Buffer.concat([Buffer.from('MTrk'), len, Buffer.from(body)]);
  };
  // 128 bpm -> 468750 us/quarter = 0x07270E
  const t0 = trk([
    [0, meta(0x03, str('Uploaded Piece'))],
    [0, meta(0x51, [0x07, 0x27, 0x0e])],
    [0, meta(0x06, str('Intro'))],
    [1920, meta(0x06, str('Main'))],
  ]);
  // Channel 10 (0x99): kick (36) at bar 0 step 0
  const t1 = trk([
    [0, meta(0x03, str('Drums'))],
    [0, [0x99, 36, 110]],
    [120, [0x89, 36, 0]],
  ]);
  // Channel 5 (0x94): bass C2 (36) at bar 0 step 0 for 4 sixteenths (480 ticks)
  const t2 = trk([
    [0, meta(0x03, str('Bass'))],
    [0, [0x94, 36, 100]],
    [480, [0x84, 36, 0]],
  ]);
  const hdr = Buffer.from([
    0x4d, 0x54, 0x68, 0x64,
    0, 0, 0, 6,
    0, 1,
    0, 3,
    0x01, 0xe0, // 480 PPQ
  ]);
  return Buffer.concat([hdr, t0, t1, t2]);
}

async function openSeq(page, { mockApi = true } = {}) {
  if (mockApi) {
    await page.route('**/api/stems/list', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { p: 'Stems/Demo Song', name: 'Demo Song', midi: true },
          { p: 'Stems/Unwritten', name: 'Unwritten', midi: false },
        ]),
      }),
    );
    await page.route('**/api/seq/midi*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sampleSong()),
        });
      }
      return route.continue();
    });
  }
  await page.goto('/sequencer/');
  await page.waitForFunction(
    () => typeof bandVoice === 'function' && typeof mfAt === 'function' && typeof MF === 'object' && !!document.getElementById('mfPanel'),
  );
  await page.evaluate(() => {
    window.__set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    window.__parts = (on) => {
      for (const p of ['Drums', 'Bass', 'Chord', 'Arp', 'Drone']) __set(`ac${p}OnSelect`, on.includes(p.toLowerCase()) ? 'on' : 'off');
      accompanyRead(); bandRead(); drumsRead();
    };
    window.__render = async (seconds, { rate = 24000 } = {}) => {
      const off = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
      off.createMediaStreamDestination = () => off.createGain();
      const Real = window.AudioContext;
      window.AudioContext = function () { return off; };
      audioCtx = null;
      try { initAudio(); } finally { window.AudioContext = Real; }
      const d = (60 / bpm) * stepBeats;
      for (let k = 0; k * d < seconds; k++) {
        accompanyAt(k, k * d);
        mfAt(k, k * d);
      }
      const buf = await off.startRendering();
      audioCtx = null;
      return buf;
    };
    window.__rms = (x, a = 0, z = x.length) => {
      let s = 0;
      for (let i = a; i < z; i++) s += x[i] * x[i];
      return Math.sqrt(s / Math.max(1, z - a));
    };
  });
}

test('mfAt plays each note once at its time, pitch, length and part, with drum velocity', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate((song) => {
    initAudio();
    bpm = 120;
    stepBeats = 0.5;
    mfLoadSong(song, { p: 'Stems/Demo Song' }, { keepTempo: true });
    MF.on = true;
    MF.tempo = 'band';
    MF.end = 'stop';
    MF.pitch = 'written';

    const calls = [];
    const origBass = window.bdBass;
    const origArp = window.bdArp;
    const origAtmos = window.atmosPlay;
    const origDrum = window.drumHit;
    window.bdBass = (e, t) => { calls.push({ fn: 'bass', t: +t.toFixed(4), hz: +e.hz.toFixed(2), dur: +e.dur.toFixed(4), vel: +(e.into ? e.into.gain.value : 1).toFixed(2) }); };
    window.bdArp = (e, t) => { calls.push({ fn: 'arp', t: +t.toFixed(4), hz: +e.hz.toFixed(2), dur: +e.dur.toFixed(4), vel: +(e.into ? e.into.gain.value : 1).toFixed(2) }); };
    window.atmosPlay = (hz, t, dur, o) => { calls.push({ fn: 'chord', t: +t.toFixed(4), hz: +hz.toFixed(2), dur: +dur.toFixed(4), vel: +(o && o.into ? o.into.gain.value : 1).toFixed(2) }); };
    window.drumHit = (slot, t, vel) => { calls.push({ fn: 'drum', slot, t: +t.toFixed(4), vel: +vel.toFixed(2) }); };

    try {
      const d = (60 / bpm) * stepBeats; // 0.25s per 8th-note boundary
      // 4 bars = 32 boundaries; step past the end (40) to prove "stop" plays nothing past bar 4.
      for (let k = 0; k < 40; k++) mfAt(k, k * d);
    } finally {
      window.bdBass = origBass;
      window.bdArp = origArp;
      window.atmosPlay = origAtmos;
      window.drumHit = origDrum;
    }
    return calls;
  }, sampleSong());

  // 3 drums + 2 bass + 2 chords + 2 arp = 9 notes total, each sounded exactly once.
  expect(got.length).toBe(9);
  const drums = got.filter((c) => c.fn === 'drum');
  expect(drums).toEqual([
    { fn: 'drum', slot: 'kick', t: 0, vel: 0.9 },
    { fn: 'drum', slot: 'snare', t: 0.5, vel: 0.7 },
    { fn: 'drum', slot: 'chh', t: 4, vel: 0.6 },
  ]);
  const bass = got.filter((c) => c.fn === 'bass');
  expect(bass).toEqual([
    { fn: 'bass', t: 0, hz: 65.41, dur: 0.5, vel: 0.85 },
    { fn: 'bass', t: 5, hz: 98.0, dur: 0.25, vel: 0.65 },
  ]);
  const chords = got.filter((c) => c.fn === 'chord');
  expect(chords).toEqual([
    { fn: 'chord', t: 0, hz: 261.63, dur: 2, vel: 0.7 },
    { fn: 'chord', t: 0, hz: 329.63, dur: 2, vel: 0.7 },
  ]);
  const arp = got.filter((c) => c.fn === 'arp');
  expect(arp).toEqual([
    { fn: 'arp', t: 2, hz: 440.0, dur: 0.5, vel: 0.8 },
    { fn: 'arp', t: 6.5, hz: 493.88, dur: 0.5, vel: 0.75 },
  ]);
});

test('section loop wraps to its first bar; remapping, unticking, tempo, scale and bandPlan work as specified', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate((song) => {
    initAudio();
    bpm = 120;
    bpmTarget = 120;
    stepBeats = 0.5;
    __parts(['drums', 'bass', 'chord']);

    // Snapshot bandPlan over 2 bars before turning MF on.
    const snap = () => {
      const out = [];
      for (let k = 0; k < 16; k++) out.push(bandPlan(k, k === 0));
      return JSON.stringify(out);
    };
    const planBefore = snap();

    // Load song while MF.on is true with tempo = 'file' -> sets Band tempo to 132.
    MF.on = true;
    MF.tempo = 'file';
    mfLoadSong(song, { p: 'Stems/Demo Song' });
    const tempoFile = Math.round(bpmTarget);
    const planWhileOn = snap();

    // Switch tempo to 'band', reset Band tempo to 105, reload song -> Band tempo stays 105.
    MF.tempo = 'band';
    bpmTarget = 105;
    bpm = 105;
    document.getElementById('bpmSlider').value = '105';
    mfLoadSong(song, { p: 'Stems/Demo Song' });
    const tempoBand = Math.round(bpmTarget);

    // Section loop: bars [2, 4) (section B) going round -> bar 2 hat plays at t=0 and wraps at t=2 bars.
    bpm = 120;
    MF.from = 2;
    MF.to = 4;
    MF.end = 'loop';
    const loopCalls = [];
    const origDrum = window.drumHit;
    const origBass = window.bdBass;
    const origArp = window.bdArp;
    window.drumHit = (slot, t) => loopCalls.push(`drum:${slot}@${t.toFixed(2)}`);
    window.bdBass = (e, t) => loopCalls.push(`bass:${e.hz.toFixed(1)}@${t.toFixed(2)}`);
    window.bdArp = (e, t) => loopCalls.push(`arp:${e.hz.toFixed(1)}@${t.toFixed(2)}`);

    const d = (60 / bpm) * stepBeats;
    mfStop();
    for (let k = 0; k < 32; k++) mfAt(k, k * d); // 4 bars = 2 passes of 2-bar section B

    // Remap Bass track (index 1) -> 'arp', untick Drums (index 0), set Other (index 3) -> 'none'.
    MF.from = 0;
    MF.to = 4;
    MF.end = 'stop';
    MF.map[0].on = false;
    MF.map[1].to = 'arp';
    MF.map[3].to = 'none';
    const remapCalls = [];
    window.drumHit = (slot, t) => remapCalls.push(`drum:${slot}@${t.toFixed(2)}`);
    window.bdBass = (e, t) => remapCalls.push(`bass:${e.hz.toFixed(1)}@${t.toFixed(2)}`);
    window.bdArp = (e, t) => remapCalls.push(`arp:${e.hz.toFixed(1)}@${t.toFixed(2)}`);
    mfStop();
    for (let k = 0; k < 32; k++) mfAt(k, k * d);

    // Pitch: "The Band's scale" moves an off-scale note to the nearest scale degree.
    // Pick a pentatonic or major scale and test a chromatic note (MIDI 70 = A#4, 100c above A4).
    const majIdx = SCALES.findIndex((s) => /Major|Ionian/i.test(s.name));
    if (majIdx >= 0) selectScale(majIdx);
    const written70 = 440 * Math.pow(2, (70 - 69) / 12);
    MF.pitch = 'written';
    const hzWritten = mfNoteHz(70, 0);
    MF.pitch = 'scale';
    const hzScaled = mfNoteHz(70, 0);
    const sc = acScaleAt(0);
    const scHzs = [];
    for (let o = -1; o <= 1; o++) for (let j = 0; j < sc.cents.length; j++) scHzs.push(acHz(sc.cents, o * sc.cents.length + j));
    const onScale = scHzs.some((h) => Math.abs(h - hzScaled) < 1e-4);

    window.drumHit = origDrum;
    window.bdBass = origBass;
    window.bdArp = origArp;

    // Turn MF off -> bandPlan returns exactly what it did before.
    mfSetOn(false);
    const planAfter = snap();

    return {
      tempoFile,
      tempoBand,
      planWhileOnEmpty: JSON.parse(planWhileOn).every((x) => x.length === 0),
      planIdentical: planBefore === planAfter,
      loopDrums: loopCalls.filter((x) => x.startsWith('drum:')),
      remapCalls,
      hzWritten: +hzWritten.toFixed(2),
      written70: +written70.toFixed(2),
      hzScaled: +hzScaled.toFixed(2),
      onScale,
      movedPitch: Math.abs(hzScaled - hzWritten) > 1,
    };
  }, sampleSong());

  expect(got.tempoFile).toBe(132);
  expect(got.tempoBand).toBe(105);
  expect(got.planWhileOnEmpty).toBe(true);
  expect(got.planIdentical).toBe(true);
  // Section B is 2 bars (4.0s at 120 bpm); bar 2 step 0 hat fires at t=0.00 and wraps at t=4.00.
  expect(got.loopDrums).toEqual(['drum:chh@0.00', 'drum:chh@4.00']);
  // Drums unticked (0), Other -> none (0), Bass remapped to arp (2 arp calls, 0 bass calls).
  expect(got.remapCalls).toEqual(['arp:65.4@0.00', 'arp:98.0@5.00']);
  expect(got.hzWritten).toBe(got.written70);
  expect(got.onScale).toBe(true);
  expect(got.movedPitch).toBe(true);
});

test('offline render with a file on has sound where notes are and silence where they are not', async ({ page }) => {
  test.setTimeout(60_000);
  await openSeq(page);
  const got = await page.evaluate(async () => {
    bpm = 120;
    stepBeats = 0.5;
    // Silence sends so tails do not spill into the quiet bar.
    for (const c of ['Bas', 'Drm', 'Chd', 'Arp', 'Drn', 'Mel']) {
      __set(`mx${c}DlySlider`, 0);
      __set(`mx${c}SpcSlider`, 0);
    }
    bandRead();
    // 2-bar song: one bass note at bar 0 step 0 (2 sixteenths = 0.25s), bar 1 completely empty.
    mfLoadSong({
      title: 'Sparse',
      bpm: 120,
      bars: 2,
      markers: [],
      parts: [{ name: 'Bass', channel: 5, notes: [[0, 0, 2, 45, 1.0]] }],
    }, { name: 'sparse.mid' }, { keepTempo: true });
    MF.on = true;
    MF.end = 'stop';
    const rate = 24000;
    const buf = await __render(4.0, { rate });
    const ch = buf.getChannelData(0);
    return {
      firstBeat: __rms(ch, 0, Math.round(0.25 * rate)),
      emptyBar: __rms(ch, Math.round(2.5 * rate), Math.round(3.8 * rate)),
    };
  });
  expect(got.firstBeat).toBeGreaterThan(0.01);
  expect(got.emptyBar).toBeLessThan(1e-4);
});

test('state survives a preset save and load', async ({ page }) => {
  await openSeq(page);
  const got = await page.evaluate((song) => {
    mfSetOn(true);
    mfLoadSong(song, { name: 'local.mid' }, { keepTempo: true });
    MF.map[0].on = false;
    MF.map[1].to = 'arp';
    MF.from = 2;
    MF.to = 4;
    MF.tempo = 'band';
    MF.end = 'stop';
    MF.pitch = 'scale';
    const saved = getPresetState();

    // Wipe current state
    mfSetOn(false);
    MF.song = null;
    MF.src = null;
    MF.map = [];
    MF.from = 0;
    MF.to = 0;
    MF.tempo = 'file';
    MF.end = 'loop';
    MF.pitch = 'written';

    applyPresetState(saved);
    return {
      on: MF.on,
      title: MF.song && MF.song.title,
      src: MF.src,
      map0: MF.map[0],
      map1: MF.map[1],
      from: MF.from,
      to: MF.to,
      tempo: MF.tempo,
      end: MF.end,
      pitch: MF.pitch,
    };
  }, sampleSong());

  expect(got).toEqual({
    on: true,
    title: 'Demo Song',
    src: { name: 'local.mid' },
    map0: { to: 'drums', on: false },
    map1: { to: 'arp', on: true },
    from: 2,
    to: 4,
    tempo: 'band',
    end: 'stop',
    pitch: 'scale',
  });
});

test('Open a file loads a real .mid via POST /api/seq/midi, rejects bad bytes, and keeps fixed sizes and fonts', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openSeq(page, { mockApi: true });
  await page.evaluate(() => document.body.classList.add('only-band'));

  // Switch Band to "A MIDI file"
  await page.locator('#mfSrcSeg button[data-v="midi"]').click();
  await expect(page.locator('#mfPanel')).toBeVisible();
  await expect(page.locator('#bdStyleSelect')).toBeDisabled();
  await expect(page.locator('#bdArrangeSelect')).toBeDisabled();

  // Upload a real .mid file (hits the real Rust POST /api/seq/midi endpoint)
  await page.locator('#mfFileInput').setInputFiles({
    name: 'upload-test.mid',
    mimeType: 'audio/midi',
    buffer: makeRealMidiBytes(),
  });
  await expect(page.locator('#mfStatus')).toHaveText('upload-test.mid');
  await expect(page.locator('#mfFacts')).toContainText('128.0 bpm');
  await expect(page.locator('#mfTracks .mf-trk')).toHaveCount(2);

  // Check fixed pixel sizes and allowed font scale
  const geom = await page.evaluate(() => {
    const panel = document.getElementById('mfPanel').getBoundingClientRect();
    const body = document.querySelector('#mfPanel .mf-body').getBoundingClientRect();
    const cols = [...document.querySelectorAll('#mfPanel .mf-col')].map((el) => Math.round(el.getBoundingClientRect().width));
    const roll = document.getElementById('mfRoll').getBoundingClientRect();
    const fonts = [...new Set(
      [...document.querySelectorAll('#mfPanel *')]
        .filter((e) => e.textContent.trim() && e.tagName !== 'OPTION' && getComputedStyle(e).display !== 'none')
        .map((e) => getComputedStyle(e).fontSize),
    )].sort();
    return {
      panelW: Math.round(panel.width),
      bodyH: Math.round(body.height),
      cols,
      roll: [Math.round(roll.width), Math.round(roll.height)],
      fonts,
    };
  });
  expect(geom.panelW).toBe(1496);
  expect(geom.bodyH).toBe(520);
  expect(geom.cols).toEqual([420, 752, 308]);
  expect(geom.roll).toEqual([730, 430]);
  for (const f of geom.fonts) expect(['9px', '10px', '11px', '13px', '16px']).toContain(f);

  // Also test picking a Stems song from the dropdown (loads the 4-track mock song)
  await page.locator('#mfSongSelect').selectOption('Stems/Demo Song');
  await expect(page.locator('#mfTracks .mf-trk')).toHaveCount(4);
  await expect(page.locator('#mfFacts')).toHaveText('132.0 bpm · 4 bars · 4 tracks');

  if (process.env.MF_SHOT) {
    await page.locator('#accompanyHost').screenshot({ path: process.env.MF_SHOT });
  }

  // Upload a bad file -> shows error from server
  await page.locator('#mfFileInput').setInputFiles({
    name: 'broken.mid',
    mimeType: 'audio/midi',
    buffer: Buffer.from('not midi at all'),
  });
  await expect(page.locator('#mfStatus')).toContainText('broken.mid');
  await expect(page.locator('#mfStatus')).toHaveClass(/\berr\b/);
});
