// The sequencer round a loop.
//
// A looped export tiles the loop: the sound goes round it as many times as
// asked, then rings out. The sequencer's part has to go round with it — its
// steps laid again from the loop's start on every repeat, nothing new through
// the tail — or it runs straight on and parts company with the sound after the
// first pass. What is checked:
//
//   - a looped render sounds the same steps at the same places on every pass,
//     and nothing new in the tail, where a straight render moves on;
//   - a take is read on the engine's clock, from where it began;
//   - the sound's export hands the sequencer the server's own loop;
//   - a composition's export renders the sequencer once, for the sound and the
//     film both;
//   - live, a jump back puts a take back where it stood, and a take that has
//     run out comes round again.

import { test, expect } from './test.mjs';

async function enterSeq(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof state !== 'undefined' && (state.folders || []).length > 0,
    { timeout: 20_000 });
  await page.locator('#leftRail [data-mode="seq"]').click();
  await page.waitForFunction(() => seq.ready === true, { timeout: 20_000 });
  return page.frames().find((f) => f.url().includes('/sequencer/'));
}

test('a looped render sounds every pass the same, and nothing new in the tail', async ({ page }) => {
  const frame = await enterSeq(page);
  const got = await frame.evaluate(async () => {
    perfLoaded = null;
    // Short notes with silence between, on eight different degrees: a pass
    // that repeats is then plainly the same, and one that moved on is not.
    const tone = () => {
      bpm = 120; stepBeats = 0.5; numSteps = 8; direction = 'fwd'; waveType = 'sine';
      steps.forEach((s, i) => { s.degree = i; s.rest = false; });
      adsr = { a: 1, d: 25, s: 0, r: 5 };
      delayWet = 0;
      lfos.forEach((l) => { l.depth = 0; });
    };
    const rate = 48000;
    tone();
    // A second of document from 0.1 s, three times round. The steps are a
    // quarter of a second apart, so they fall 0.15 s into each pass, then
    // 0.40, 0.65 and 0.90.
    const looped = await seqBridge.renderFilm({ at0: 0.1, seconds: 3.6, rate, fps: 20, bands: 8, liss: 16, loop: { span: 1, repeats: 3 } });
    tone();
    const straight = await seqBridge.renderFilm({ at0: 0.1, seconds: 3, rate, fps: 20, bands: 8, liss: 16 });
    const seg = (buf, a) => buf.subarray(Math.round(a * rate), Math.round(a * rate) + rate);
    const apart = (x, y) => {
      let e = 0, p = 0;
      for (let i = 0; i < x.length; i++) { e += (x[i] - y[i]) ** 2; p += x[i] ** 2; }
      return e / Math.max(1e-12, p);
    };
    const loudest = (buf, a, b) => {
      let m = 0;
      for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) m = Math.max(m, Math.abs(buf[i]));
      return m;
    };
    const onsets = (buf) => {
      const out = [];
      let quiet = rate;
      for (let i = 0; i < buf.length; i++) {
        if (Math.abs(buf[i]) > 2e-3) {
          if (quiet > 0.04 * rate) out.push(i / rate);
          quiet = 0;
        } else quiet++;
      }
      return out;
    };
    return {
      samePasses: [apart(seg(looped.left, 0), seg(looped.left, 1)), apart(seg(looped.left, 1), seg(looped.left, 2))],
      movedOn: apart(seg(straight.left, 0), seg(straight.left, 1)),
      tail: loudest(looped.left, 3.05, 3.6),
      loud: loudest(looped.left, 0, 3),
      onsets: onsets(looped.left),
    };
  });
  expect(got.loud, 'the render is silent').toBeGreaterThan(0.01);
  expect(got.onsets.length, `onsets at ${got.onsets.map((t) => t.toFixed(3))}`).toBe(12);
  const want = [0, 1, 2].flatMap((pass) => [0.15, 0.4, 0.65, 0.9].map((t) => pass + t));
  got.onsets.forEach((t, i) => expect(t, `onset ${i + 1}`).toBeCloseTo(want[i], 2));
  for (const e of got.samePasses) expect(e, 'a pass round the loop is not the pass before it').toBeLessThan(1e-3);
  expect(got.movedOn, 'the straight render repeated itself').toBeGreaterThan(0.3);
  expect(got.tail, 'the tail sounded a new note').toBeLessThan(1e-3);
});

test('a take is read on the engine\'s clock, from where it began', async ({ page }) => {
  const frame = await enterSeq(page);
  const got = await frame.evaluate(() => {
    const snapshot = getPresetState();
    const take = {
      id: 'late', name: 'late', startAt: 10, duration: 4, snapshot,
      gestures: [
        { kind: 'slider', id: 'cutoffSlider', t0: 0.5, t1: 1.5, points: [[0.5, 20], [1.5, 80]] },
        { kind: 'discrete', type: 'select', id: 'waveSelect', t: 2, v: 'square' },
        { kind: 'discrete', type: 'play', t: 0.1 },
      ],
    };
    return {
      snap: parseFloat(snapshot.sliders.cutoffSlider),
      before: seqBridge.takeValuesAt(take, 9),
      mid: seqBridge.takeValuesAt(take, 11),
      after: seqBridge.takeValuesAt(take, 12.5),
    };
  });
  expect(got.before.t).toBe(-1);
  expect(got.before.sliders.cutoffSlider, 'before the take began, the knob is where the take found it').toBe(got.snap);
  expect(got.before.thrown).toEqual([]);
  expect(got.mid.sliders.cutoffSlider).toBeCloseTo(50, 6);
  expect(got.mid.thrown).toEqual([]);
  expect(got.after.sliders.cutoffSlider).toBe(80);
  expect(got.after.thrown, 'the switch was not thrown, or the transport\'s play was').toEqual([1]);
});

test('the sound\'s export lays the sequencer on the server\'s loop', async ({ page }) => {
  await enterSeq(page);
  const asked = await page.evaluate(async () => {
    const asked = [];
    const real = seqRenderForFilm;
    const realFetch = window.fetch;
    seqRenderForFilm = async (spec) => { asked.push(spec); return { left: new Float32Array(8), right: new Float32Array(8) }; };
    window.fetch = async (url, opts) => (String(url).startsWith('/api/export/stem')
      ? new Response('{"frames":8}', { status: 200 }) : realFetch(url, opts));
    try {
      // Half a second in, a quarter of a second long, four times round.
      await exportAddStem({ frames: 96000, sampleRate: 48000, loop: { from: 24000, frames: 12000, repeats: 4 } },
        { withSeq: true, grain: true, at0: 99, bits: 24 });
      await exportAddStem({ frames: 48000, sampleRate: 48000, loop: null },
        { withSeq: true, grain: true, at0: 1.5, bits: 24 });
    } finally {
      seqRenderForFilm = real;
      window.fetch = realFetch;
    }
    return asked.map(({ onProgress, ...s }) => s);
  });
  expect(asked.length).toBe(2);
  expect(asked[0].at0, 'the loop\'s start is the server\'s').toBe(0.5);
  expect(asked[0].loop).toEqual({ span: 0.25, repeats: 4 });
  expect(asked[0].seconds).toBe(2);
  expect(asked[0].rate).toBe(48000);
  expect(asked[1].at0).toBe(1.5);
  expect(asked[1].loop).toBeNull();
});

test('a composition\'s export renders the sequencer once, for the sound and the film', async ({ page }) => {
  await enterSeq(page);
  const got = await page.evaluate(async () => {
    let renders = 0;
    const realPost = seqPost;
    seqPost = (m) => {
      if (m.type !== 'seq:render') return realPost(m);
      renders++;
      const n = Math.ceil(m.seconds * m.rate);
      const data = {
        type: 'seq:rendered', id: m.id, rate: m.rate, seconds: m.seconds, frames: Math.ceil(m.seconds * m.fps),
        left: new Float32Array(n), right: new Float32Array(n), spectra: new Float32Array(1),
        liss: new Float32Array(1), lissN: m.liss, bands: m.bands,
      };
      window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin }));
    };
    const loop = { span: 0.25, repeats: 4 };
    const fps = videoPollHz();
    // What the film asks for: its reel's frames at its rate, outro and all.
    const filmSpec = {
      at0: 0.5, rate: 48000, fps, bands: VG_FLOOR_BANDS, lo: 20, hi: 20000, liss: VG_LISS_POINTS, loop,
      seconds: Math.ceil((2 + videoOutroSeconds()) * fps) / fps,
    };
    try {
      seqShared = {};
      const sound = await seqRenderForFilm({ at0: 0.5, seconds: 2, rate: 48000, loop, fps: 1, bands: 8, liss: 16, ...seqShareSpec(2) });
      const film = await seqRenderForFilm({ ...filmSpec });
      const shared = { renders, same: sound === film };
      // Somewhere else, or once the export is over, it renders afresh.
      const elsewhere = await seqRenderForFilm({ ...filmSpec, at0: 0.75 });
      seqShared = null;
      const after = await seqRenderForFilm({ ...filmSpec });
      return { shared, elsewhere: elsewhere !== sound, total: renders, after: after !== sound };
    } finally {
      seqPost = realPost;
      seqShared = null;
    }
  });
  expect(got.shared.renders, 'the sound and the film each rendered the sequencer').toBe(1);
  expect(got.shared.same).toBe(true);
  expect(got.elsewhere).toBe(true);
  expect(got.after).toBe(true);
  expect(got.total).toBe(3);
});

test('live, a jump back puts the take back, and a take that ran out comes round again', async ({ page }) => {
  const frame = await enterSeq(page);
  await frame.evaluate(() => {
    const snapshot = getPresetState();
    snapshot.selects.waveSelect = 'sine';
    perfLoaded = {
      id: 'round', name: 'round', created: 0, generated: false, duration: 2, startAt: 0,
      wasPlaying: true, snapshot,
      gestures: [{ kind: 'discrete', type: 'select', id: 'waveSelect', t: 1, v: 'square', gen: false }],
    };
  });
  // In past where the take ends: its switch is thrown at once, and it stops.
  await page.evaluate(() => { playbackTime = () => 2.5; seqSync(true); });
  await frame.waitForFunction(() => !perfReplay, null, { timeout: 3_000 });
  expect(await frame.evaluate(() => document.getElementById('waveSelect').value)).toBe('square');
  // The loop comes round to the start: the take stands where it began...
  await page.evaluate(() => seqPost({ type: 'seq:clock', playing: true, at: 0.3 }));
  await frame.waitForFunction(() => !!perfReplay, null, { timeout: 3_000 });
  expect(await frame.evaluate(() => document.getElementById('waveSelect').value),
    'the jump back did not put the take back').toBe('sine');
  // ...and throws its switch again when it gets there.
  await frame.waitForFunction(() => document.getElementById('waveSelect').value === 'square', null, { timeout: 3_000 });
  await page.evaluate(() => seqSync(false));
});
