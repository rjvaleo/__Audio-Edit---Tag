// Filming the room.
//
// The one thing worth asserting about a muxer is that a decoder opens what it
// wrote. Everything else — the box tree parsing, the lengths adding up — can be
// true of a file that no player will touch, and was: the first file out of this
// had a well-formed box at every level and a sample rate written through a
// signed 32-bit shift, so the audio sample entry was nonsense and the whole
// thing failed silently. See `docs/VIDEO-EXPORT.md`.

import { test, expect } from '@playwright/test';

test.setTimeout(180_000);

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
  await page.waitForSelector('#masterBus .mb-cell-3d', { state: 'visible', timeout: 20_000 });
}

test('the room films, and a decoder opens what came out', async ({ page }) => {
  await openFile(page);
  const out = await page.evaluate(async () => {
    const why = videoExportSupport();
    if (why) return { skip: why };
    const size = { key: 'test', label: 'test', w: 320, h: 180 };
    const fps = 30;
    const blob = await videoExport({
      path: state.selectedFile.path,
      from: 0, to: 0, repeats: 0, tail: false,
      size, fps,
      camera: roomCameraDrawn(),
      layers: roomLayers(), occlude: roomOcclude(), order: roomOrder(),
      room: { cold: [0.2, 0.45, 0.85], hot: [1, 0.72, 0.35], core: [0.55, 0.85, 1] },
      background: getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#000',
      fetchSchedule: (from, to) => api(
        `/api/grains?p=${encodeURIComponent(state.selectedFile.path)}&from=${from}&to=${to}`,
      ).catch(() => null),
      padSeconds: GRAIN_PLAYHEAD_PAD,
      loopOut: null,
      onStage: () => {},
    });

    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const str = (a, b) => String.fromCharCode(...head.slice(a, b));

    // The only check that counts.
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    const opened = await new Promise((res) => {
      let done = false;
      const finish = (o) => { if (!done) { done = true; res(o); } };
      v.onloadedmetadata = () => finish({
        ok: true, duration: v.duration, w: v.videoWidth, h: v.videoHeight,
      });
      v.onerror = () => finish({ ok: false, err: (v.error || {}).message || 'refused' });
      setTimeout(() => finish({ ok: false, err: 'timed out' }), 15_000);
      v.src = url;
    });
    URL.revokeObjectURL(url);

    const status = await api('/api/video');
    return {
      bytes: blob.size,
      type: blob.type,
      ftyp: str(4, 8),
      opened,
      // What the picture should be: the reel's length plus nothing, since the
      // outro is already in it.
      wanted: status.frames / (1000 / MB_POLL_MS),
      size, fps,
    };
  });
  if (out.skip) test.skip(true, out.skip);

  expect(out.ftyp, 'the file does not begin with an ftyp box').toBe('ftyp');
  expect(out.type).toBe('video/mp4');
  expect(out.bytes, 'the file is empty').toBeGreaterThan(10_000);

  expect(out.opened.ok, `a decoder would not open it: ${out.opened.err}`).toBe(true);
  expect(out.opened.w, 'it opened at the wrong width').toBe(out.size.w);
  expect(out.opened.h, 'it opened at the wrong height').toBe(out.size.h);
  // Within a frame of what was asked for. A file whose declared length does not
  // match its content is one that some players stop early and some pad.
  expect(Math.abs(out.opened.duration - out.wanted),
    `it reports ${out.opened.duration}s and should be ${out.wanted}s`)
    .toBeLessThan(2 / out.fps + 0.05);
});

/// The picture outlives the sound, and the sound runs the whole way as silence.
test('the video runs past the audio, and both streams end together',
  async ({ page }) => {
    await openFile(page);
    const out = await page.evaluate(async () => {
      const outro = videoOutroSeconds();
      await postJSON('/api/video', {
        p: state.selectedFile.path,
        fps: 1000 / MB_POLL_MS,
        bands: VG_FLOOR_BANDS, liss: VG_LISS_POINTS, fft: 4096,
        outro,
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 150));
        const s = await api('/api/video');
        if (s.error) throw new Error(s.error);
        if (!s.running && s.phase === 'ready') {
          return {
            outro,
            seconds: s.frames / (1000 / MB_POLL_MS),
            audioSeconds: s.audioFrames / s.rate,
          };
        }
        if (!s.running) throw new Error(s.phase);
      }
    });

    // Derived from the room's own two constants, not written down.
    expect(out.outro, 'the outro is not the room emptying').toBeCloseTo(56 * 50 / 1000, 6);
    // Both streams are the same length, to a frame.
    expect(Math.abs(out.seconds - out.audioSeconds),
      `picture is ${out.seconds}s and sound is ${out.audioSeconds}s`)
      .toBeLessThan(0.06);
    // And the picture is longer than the sound was, by the outro.
    expect(out.seconds, 'there is no outro at all').toBeGreaterThan(out.outro);
  });

/// The video is the room, not a room.
///
/// It is drawn by a second `vis-gl` on a canvas of its own, and every way that
/// canvas differs from the one on screen is a way the film comes out looking
/// like something else. Two of those turned up at once: the room clears to
/// transparent and shows the page through it, so an offscreen canvas had
/// nothing behind it and H.264 — which has no alpha — composited it against
/// whatever it assumed; and the grain schedule was never handed over at all, so
/// the cloud simply was not there.
test('what gets encoded is opaque, and has the cloud in it', async ({ page }) => {
  await openFile(page);
  const out = await page.evaluate(async () => {
    if (videoExportSupport()) return { skip: videoExportSupport() };
    const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    // Counted, so the test can say the film asked for its cloud the way the
    // live room does rather than in one lump.
    const asked = [];
    const grainsAt = (from, to) => {
      asked.push([from, to]);
      return api(`/api/grains?p=${encodeURIComponent(state.selectedFile.path)}`
        + `&from=${from}&to=${to}`).catch(() => null);
    };

    // Look at what the encoder is actually handed, rather than at the file.
    const seen = [];
    const Real = window.VideoFrame;
    const handed = [];
    window.VideoFrame = class extends Real {
      constructor(src, init) {
        if (seen.length < 4) {
          const c = document.createElement('canvas');
          c.width = 64; c.height = 36;
          const g = c.getContext('2d');
          g.drawImage(src, 0, 0, 64, 36);
          const d = g.getImageData(0, 0, 64, 36).data;
          seen.push({ alpha: d[3], corner: [d[0], d[1], d[2]] });
        }
        super(src, init);
      }
    };
    // And at what the room is asked to draw.
    const realFrame = visGl.frame;
    await videoExport({
      path: state.selectedFile.path,
      from: 0, to: 0, repeats: 0, tail: false,
      size: { w: 320, h: 180 }, fps: 30,
      camera: roomCameraDrawn(),
      layers: roomLayers(), occlude: roomOcclude(), order: roomOrder(),
      room: { cold: [0.2, 0.45, 0.85], hot: [1, 0.72, 0.35], core: [0.55, 0.85, 1] },
      background: bg,
      fetchSchedule: grainsAt,
      padSeconds: GRAIN_PLAYHEAD_PAD,
      loopOut: null,
      onStage: () => {},
    });
    window.VideoFrame = Real;
    visGl.frame = realFrame;
    return {
      bg,
      seen,
      asked,
      // Every request is a window rather than the whole document.
      windowed: asked.every(([a, b]) => b > a),
    };
  });
  if (out.skip) test.skip(true, out.skip);

  // Every frame the encoder is given is opaque. A transparent one is a frame
  // whose colour is decided by the encoder rather than by the theme.
  for (const f of out.seen) {
    expect(f.alpha, `a frame reached the encoder at alpha ${f.alpha}`).toBe(255);
  }
  // And it is the theme's ground, not black — the two are not the same and the
  // difference is exactly what "the colour is wrong" looked like.
  const [r, g, b] = out.seen[0].corner;
  expect(r + g + b, 'the ground is pure black, so nothing was painted behind the room')
    .toBeGreaterThan(0);

  // **The cloud is asked for in windows**, the way the live room asks for it.
  // The cap on a request is spent inside the range asked for, so one request
  // for the whole document leaves any given moment nearly empty — which reads
  // as a cloud that is not there.
  expect(out.asked.length, 'no schedule was fetched, so there is no cloud to draw')
    .toBeGreaterThan(0);
  expect(out.windowed, `the schedule was asked for as ${JSON.stringify(out.asked[0])}`
    + ' — that is not a window').toBe(true);
});

/// The film runs on its own clock, not the machine's.
///
/// **Everything in the room that moves on its own was aged against
/// `performance.now()`** — right for a room being watched, wrong for one being
/// filmed. An offline render goes as fast as the machine manages, so the gap
/// between frames is however long the last one took to encode: a frame that
/// took fifty milliseconds aged the cloud by fifty and the next by five. What
/// that looks like in the finished file is a stutter, the picture lurching once
/// and carrying on, and it was reported as exactly that.
test('a stall while rendering does not reach the file', async ({ page }) => {
  await openFile(page);
  const out = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const gl = vgAttach(c);
    if (!gl) return null;
    const raw = c.getContext('webgl');
    const sr = 44100, grains = [];
    for (let i = 0; i < 400; i++) {
      const t = i / 60;
      grains.push([Math.round(t * sr), Math.round((t / 6) * sr * 10),
        Math.round(sr * 0.04), 0, 0.6, 0.5, 0, i]);
    }
    const run = (useClock, stall) => {
      // Empty the room first, or the last film's cloud is still in the air and
      // its clock is still where it stopped.
      gl.clear();
      const seen = [];
      for (let k = 0; k < 90; k++) {
        const t = k / 30;
        // What a slow encode or a collection pause does to a render.
        if (stall && k === 45) {
          const until = performance.now() + 120;
          while (performance.now() < until) { /* hold the thread */ }
        }
        gl.frame({
          cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
          cam: roomCamera(),
          layers: { room: false, floor: false, lead: false, sky: false,
            skin: false, grains: true },
          order: roomOrder(), occlude: {},
          ...(useClock ? { clock: t } : {}),
          grains, grainRate: sr, srcFrames: sr * 10, positionRate: sr, pollMs: 50,
          position: Math.round(sr * t),
        });
        const px = new Uint8Array(c.width * c.height * 4);
        raw.readPixels(0, 0, c.width, c.height, raw.RGBA, raw.UNSIGNED_BYTE, px);
        let lit = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] + px[i + 1] + px[i + 2] > 12) lit++;
        }
        seen.push(lit);
      }
      return seen;
    };
    const differ = (useClock) => {
      const a = run(useClock, false);
      const b = run(useClock, true);
      let n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
      return { changed: n, of: a.length };
    };
    return { wall: differ(false), clock: differ(true) };
  });
  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // On the machine's clock the stall is in the picture.
  expect(out.wall.changed, 'a stall changed nothing even on the wall clock — the '
    + 'test is no longer stalling anything').toBeGreaterThan(10);
  // On the film's clock it is not there at all: the same film, frame for frame,
  // whatever the machine was doing while it was made.
  expect(out.clock.changed, `${out.clock.changed} of ${out.clock.of} frames moved `
    + 'because the render was slow — the film is still on the machine\'s clock')
    .toBe(0);
});

