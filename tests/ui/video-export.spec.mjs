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


// ── the camera the film is shot with ──
//
// `docs/ROOM-EDITOR.md`: *"Each frame keeps its own camera. That is what the
// video export reads when a size is chosen, so picking Vertical in the export
// box gets the camera that was designed for vertical rather than the wide one
// squeezed."*
//
// That was the intent and not the behaviour. The export read `roomEdit.frame` —
// whatever the view happened to be showing — so posing the room for 9:16 and
// then exporting HD filmed the portrait camera into a landscape frame.

test('the film is shot with the camera posed for its own shape', async ({ page }) => {
  await openFile(page);
  const got = await page.evaluate(() => {
    roomEdit.cams = {
      '16x9': { depth: 1.9, floorY: -0.38, ceilY: 0.62, shiftX: 0, skyAt: 0.72, ring: 0.17 },
      '9x16': { depth: 4.4, floorY: -0.90, ceilY: 0.20, shiftX: 0, skyAt: 0.30, ring: 0.50 },
    };
    // The view is showing portrait. What is exported must not follow it.
    roomEdit.frame = '9x16';
    const of = (w, h) => {
      const c = roomCameraForAspect(w / h);
      return { frame: roomFrameForAspect(w / h), depth: +c.depth.toFixed(2) };
    };
    return { hd: of(1920, 1080), vertical: of(1080, 1920), square: of(1080, 1080) };
  });

  expect(got.hd.frame).toBe('16x9');
  expect(got.hd.depth, 'a wide film takes the wide camera, not the one on screen').toBe(1.9);
  expect(got.vertical.frame).toBe('9x16');
  expect(got.vertical.depth).toBe(4.4);
  // A shape nobody has posed falls back to the one being looked at, which is at
  // least a pose somebody chose — better than a shipped constant.
  expect(got.square.frame).toBe('1x1');
  expect(got.square.depth).toBe(4.4);
});

// ── the bar during the render ──
//
// The render ahead of the filming is the same one an audio export makes, and it
// reports itself through the server's export tracker. The video's status route
// read the *video* job, which has nothing to say until the analysis starts — so
// the first phase sat at a hard zero. On a forty-times stretch that is minutes
// of a dead bar, which reads as a hang.

test('the render phase reports progress rather than sitting at zero', async ({ page }) => {
  await openFile(page);
  const seen = await page.evaluate(async () => {
    // **The longest file there is, stretched as far as it will go.** An
    // unstretched render of a short file finishes inside a single poll, so the
    // phase this test exists for is never sampled — the first cut asserted on a
    // run whose very first report was already `Analysing` and read that as the
    // render being silent, and the second picked whichever file came first
    // alphabetically, which in the test library is a tenth of a second long.
    //
    // The fault only shows on a long render, which is also the only time
    // anybody notices it.
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    const longest = files.slice().sort((a, b) => (b.frames || 0) - (a.frames || 0))[0];
    const p = longest.path;
    await postJSON('/api/edit', { p, op: 'stretch', ratio: 100, algorithm: 'wsola' });
    try {
      await postJSON('/api/video', { p, from: 0, to: 0, repeats: 0, tail: false,
        fps: 20, bands: 64, liss: 128, fft: 2048, outro: 0.5 });
      const out = [];
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const s = await api('/api/video');
        out.push({ phase: s.phase, done: s.done, total: s.total,
          stage: s.stage, frac: s.fraction });
        if (!s.running && (s.phase === 'ready' || s.phase === 'failed')) break;
        // Enough of the render seen to prove the point; the rest is time.
        if (out.filter((x) => x.phase === 'rendering').length > 8) break;
      }
      await postJSON('/api/video/stop', {});
      return out;
    } finally {
      // The document is the library's, not the test's.
      await postJSON('/api/edit', { p, op: 'stretch', ratio: 1 });
    }
  });

  const render = seen.filter((s) => s.phase === 'rendering');
  expect(render.length, 'the render phase was actually observed').toBeGreaterThan(1);
  // **The fault, said plainly.** The phase named itself the whole time and the
  // number behind it never moved: `done` 0 of a `total` of 1, because the
  // render reports into the server's export tracker and this route was reading
  // the video job. On a forty-times stretch that is minutes of a dead bar.
  expect(Math.max(...render.map((s) => s.total)), 'it has a real total').toBeGreaterThan(1);
  expect(Math.max(...render.map((s) => s.done)), 'and a count that moves').toBeGreaterThan(0);
  // And it says which of the render's own passes it is in. Reading, stretching
  // and writing cost wildly different amounts per frame, so a bar with no
  // account of which one it is in moves in unexplained lurches.
  const stages = new Set(render.map((s) => s.stage).filter(Boolean));
  expect([...stages].length, 'the render names its inner stage').toBeGreaterThan(0);
});

// ── the schedule, printed on the filmed wall ──
//
// The live block is HTML *behind* the canvas — the room is drawn on glass over
// it — so an export that filmed only the canvas left it out of the file
// entirely. A layer that could be switched on in the view was simply absent
// from the render.

test('the data block is filmed, and lands on the back wall', async ({ page }) => {
  await openFile(page);
  const out = await page.evaluate(async () => {
    if (videoExportSupport()) return { skip: videoExportSupport() };
    const size = { w: 480, h: 270 };
    // **Two cameras that are genuinely different**, or the placement assertion
    // below cannot tell the filmed one from the one on screen. Posing only the
    // shape being filmed leaves `roomCameraForAspect` falling back to the
    // current view — the same camera by another route, and a wall in the same
    // place either way. The first cut of this test did exactly that and passed
    // with the wrong camera deliberately wired in.
    roomEdit.cams = {
      '16x9': { depth: 1.6, floorY: -0.30, ceilY: 0.55, shiftX: 0, skyAt: 0.72, ring: 0.17 },
      dock: { depth: 5.5, floorY: -0.95, ceilY: 0.25, shiftX: 0.4, skyAt: 0.3, ring: 0.5 },
    };
    roomEdit.frame = 'dock';
    const camera = roomCameraForAspect(size.w / size.h);

    // What the *encoder* is handed, which is the ground, the block and the room
    // composited — not the GL canvas on its own, which is the thing that never
    // had the block in it.
    const grab = async (dataOn) => {
      const shots = [];
      const Real = window.VideoFrame;
      window.VideoFrame = class extends Real {
        constructor(src, init) {
          if (shots.length < 1) {
            const c = document.createElement('canvas');
            c.width = size.w; c.height = size.h;
            const g = c.getContext('2d');
            g.drawImage(src, 0, 0);
            shots.push(g.getImageData(0, 0, size.w, size.h).data);
          }
          super(src, init);
        }
      };
      try {
        await videoExport({
          path: state.selectedFile.path,
          from: 0, to: 0, repeats: 0, tail: false,
          size, fps: 30, camera,
          // Only the box, so the wall has an edge to check the block against
          // without a terrain crossing the same pixels.
          layers: { room: true, floor: false, lead: false, sky: false,
            skin: false, grains: false, data: dataOn },
          occlude: {}, order: roomOrder(),
          // Blue room, so nothing the room draws is red.
          room: { cold: [0.1, 0.3, 0.9], hot: [0.2, 0.5, 1], core: [0.3, 0.6, 1] },
          background: '#000',
          data: {
            on: dataOn,
            chunk: roomEdit.chunk,
            opacity: 1,
            // Pure red. Nothing else in this film draws red, so a red pixel came
            // from the block and from nothing else.
            colour: '#ff0000',
            head: roomDataHead(false),
            ch: roomChPx(document.getElementById('roomData')) || 5.1,
            line: ROOM_LINE,
            font: 'monospace',
            fontPx: 7,
            scale: 1.5,
          },
          fetchSchedule: (f, t) => api(
            `/api/grains?p=${encodeURIComponent(state.selectedFile.path)}&from=${f}&to=${t}`,
          ).catch(() => null),
          padSeconds: GRAIN_PLAYHEAD_PAD,
          loopOut: null,
          onStage: () => {},
        });
      } finally {
        window.VideoFrame = Real;
      }
      return shots[0];
    };

    const red = (d) => {
      let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < size.h; y++) {
        for (let x = 0; x < size.w; x++) {
          const i = (y * size.w + x) * 4;
          if (d[i] > 70 && d[i] > d[i + 1] * 2 + 30 && d[i] > d[i + 2] * 2 + 30) {
            n++;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      return { n, x0, x1, y0, y1 };
    };

    const on = red(await grab(true));
    const off = red(await grab(false));
    return { on, off, wall: roomBackWall(size.w, size.h, camera), size };
  });
  if (out.skip) test.skip(true, out.skip);

  // **It is in the film.** This is the whole fault: before, the answer was zero.
  expect(out.on.n, 'the block was not filmed at all').toBeGreaterThan(200);
  // And it is the block that put it there, not something else that happens to
  // be reddish — with the layer off there is none of it.
  expect(out.off.n, 'red appeared with the block switched off').toBeLessThan(20);

  // **On the wall, not over the frame.** The wall is smaller than the canvas by
  // the room's own convergence, and it is worked out for the camera being
  // filmed with rather than the one on screen. A block using the wrong camera,
  // or the live canvas size, lands somewhere else entirely.
  const w = out.wall;
  const slack = 3;
  expect(out.on.x0).toBeGreaterThanOrEqual(Math.floor(w.x) - slack);
  expect(out.on.x1).toBeLessThanOrEqual(Math.ceil(w.x + w.w) + slack);
  expect(out.on.y0).toBeGreaterThanOrEqual(Math.floor(w.y) - slack);
  expect(out.on.y1).toBeLessThanOrEqual(Math.ceil(w.y + w.h) + slack);
  // And it is not a stripe in one corner — it fills a good part of the wall.
  expect(out.on.x1 - out.on.x0, 'the block barely spans the wall')
    .toBeGreaterThan(w.w * 0.3);
});

// ── the export box's own layout ──
//
// `.field` is `width: 100%`, which is right for a field with a line to itself
// and wrong for two of them in a flex row: each asks for the whole row, so the
// pair took 946 px of 1046 and squeezed the note beside them into a 40 px
// column three hundred pixels tall — a stack of single letters.

test('the video menus leave room for the line they sit on', async ({ page }) => {
  await openFile(page);
  await page.evaluate(() => document.getElementById('videoBtn').click());
  await page.waitForSelector('#exportLoop #elVideoSize', { state: 'visible' });

  const got = await page.evaluate(() => {
    const sel = document.getElementById('elVideoSize');
    const fps = document.getElementById('elVideoFps');
    const row = sel.closest('.fx-row');
    const note = row.querySelector('.fx-note');
    const w = (el) => el.getBoundingClientRect().width;
    const h = (el) => el.getBoundingClientRect().height;
    return {
      row: w(row), size: w(sel), fps: w(fps),
      noteW: w(note), noteH: h(note),
      // The longest option still fits rather than being clipped to "Square la…".
      clipped: sel.scrollWidth > sel.clientWidth + 1,
    };
  });

  // Together they take a modest share of the row, not nearly all of it.
  expect((got.size + got.fps) / got.row,
    'the two menus take most of the row').toBeLessThan(0.45);
  // **The note is a line of prose, not a column of letters.** This is the check
  // that names the actual complaint: it was 40 px wide and 317 tall.
  expect(got.noteW, 'the note is squeezed into a column').toBeGreaterThan(got.row * 0.4);
  expect(got.noteH, 'the note has wrapped into a tower').toBeLessThan(60);
  expect(got.clipped, 'the size menu cannot show its own longest option').toBe(false);
});
