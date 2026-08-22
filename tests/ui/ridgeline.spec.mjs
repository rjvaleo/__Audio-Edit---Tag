// The ridgeline: stacked lines, each one hiding what is behind it.
//
// See `docs/RIDGELINE.md`. What is worth testing here is not that it draws —
// that is obvious the moment it is looked at. It is:
//
//   - the **fill**, which is the entire design. Without it every line shows
//     through every other one and the picture is a hairball.
//   - **silence is flat**, which is the brief, and
//   - **sound makes peaks in the middle**, which is the other half of it.
//
// Every count here is **lines crossed down a column**, never lit area. The room
// next door taught that lesson expensively: a filled stack covers the same area
// however many rows it has, and three separate area measurements reported a
// working control doing nothing.

import { test, expect } from '@playwright/test';

async function openRidge(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof setMode === 'function' && typeof rdgAttach === 'function',
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    localStorage.removeItem('roomData');
    roomEdit.ridge = {};
    setMode('room');
  });
  await page.waitForSelector('#roomStageRoom #visRidge, #roomStageRoom #visGl',
    { state: 'attached', timeout: 20_000 });
  await page.evaluate(() => setVisModule('ridge'));
  await page.waitForFunction(() => {
    const c = document.getElementById('visRidge');
    return c && c.clientWidth > 100;
  }, null, { timeout: 10_000 });
}

/// One instant, used for every push and every draw in these tests.
///
/// The stack slides between pushes, so a picture taken at an arbitrary moment is
/// somewhere between two rows. Pinning the clock puts it exactly on a row —
/// which is also the property the film depends on: the same pushes and the same
/// clock give the same picture, always.
const RDG_CLOCK = 100000;

/// Count dark→light transitions down one column, at the canvas's own resolution.
///
/// **Not lit area, and not a downscaled copy.** Halving the canvas aliases
/// hairlines into dashes and reports a clean stack as a broken one — the same
/// mistake that read the room's box as absent until it was sampled at native
/// size.
const CROSS = `((xFrac) => {
  // **Draw before reading, and on a clock we choose.** The canvas holds whatever
  // was last painted, and pushing rows does not paint — a probe that only reads
  // is reading a stale picture, which once reported two lines where there were
  // eighty.
  //
  // The clock matters because the stack *slides* between pushes. Left to the
  // wall clock the picture is caught at an arbitrary fraction of a row, so the
  // count comes back eighty or eighty-one depending on when the test ran.
  // RDG_CLOCK is the instant of the last push, which puts the slide at nought
  // and the spare row exactly off the top.
  visGlTick();
  const c = document.getElementById('visRidge');
  visRenderer().frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: ${RDG_CLOCK} });
  const g = c.getContext('2d');
  const x = Math.round(c.width * xFrac);
  const d = g.getImageData(x, 0, 1, c.height).data;
  let n = 0, prev = false;
  for (let y = 0; y < c.height; y++) {
    const on = d[y*4] + d[y*4+1] + d[y*4+2] > 200;
    if (on && !prev) n++;
    prev = on;
  }
  return n;
})`;

/// A burst in the middle of the window, loudness and centre varying per row.
///
/// **Varying, because identical rows can never occlude one another.** Each row
/// sits exactly one gap below the last, so a stack of eighty identical pulses
/// hides nothing at all — the first version of this pushed the same burst every
/// time, measured three hidden lines, and read that as the fill barely working.
const FEED = `((r, rows, amp0) => {
  const burst = (amp, centre) => {
    const n = 1024, a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = Math.exp(-Math.pow((t - centre) * 7, 2));
      const v = Math.sin(i * 0.35) * env * amp;
      a[i*2] = v; a[i*2+1] = v;
    }
    return a;
  };
  const bands = new Float32Array(128).fill(-18);
  // Put the module on the pinned clock before pushing, so every row is stamped
  // with it and the slide reads as nought when the picture is taken.
  r.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: ${RDG_CLOCK} });
  for (let i = 0; i < rows; i++) {
    const amp = amp0 * (0.25 + 0.75 * Math.abs(Math.sin(i * 0.7)));
    r.push(bands, burst(amp, 0.5 + Math.sin(i * 0.31) * 0.06));
  }
})`;

test('both modules answer the same contract', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(() => {
    const out = {};
    for (const m of VIS_MODULES) {
      const c = document.getElementById(m.canvas);
      const r = m.key === visModuleKey() ? visRenderer() : null;
      out[m.key] = { canvas: !!c, live: r ? ['push', 'frame', 'clear']
        .every((k) => typeof r[k] === 'function') : 'not attached' };
    }
    return out;
  });
  expect(got.room.canvas).toBe(true);
  expect(got.ridge.canvas).toBe(true);
  expect(got.ridge.live).toBe(true);
  // And the third, which is the whole point of there being a contract at all.
  expect(got.room3d.canvas).toBe(true);
});

/// The early list of keys and the real list of modules say the same thing.
///
/// **They are two lists because they have to be.** The stored settings are read
/// at load, before `VIS_MODULES` exists — and a `const` touched before its
/// declaration throws rather than coming back undefined, so reading it there
/// takes the whole script down. `VIS_MODULE_KEYS` is a plain list early enough
/// to use; `VIS_MODULES` carries the canvases and the attach functions and
/// cannot move up to meet it.
///
/// Two lists that must agree is exactly the arrangement that quietly stops
/// agreeing. This is the thing that keeps them honest — a module missing from
/// the early list is remembered, stored, and then silently dropped on the way
/// back in, which is a fault with nothing on screen to explain it.
test('every module is in the list read at load', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof VIS_MODULES !== 'undefined');
  const got = await page.evaluate(() => ({
    modules: VIS_MODULES.map((m) => m.key),
    early: VIS_MODULE_KEYS.slice(),
  }));
  expect(got.early.slice().sort()).toEqual(got.modules.slice().sort());
});

test('choosing a module shows one canvas and hides the other', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(() => {
    const shown = () => ({
      room: !document.getElementById('visGl').classList.contains('hidden'),
      ridge: !document.getElementById('visRidge').classList.contains('hidden'),
      room3d: !document.getElementById('visRoom3d').classList.contains('hidden'),
    });
    setVisModule('ridge');
    const onRidge = shown();
    setVisModule('room');
    const onRoom = shown();
    setVisModule('room3d');
    const onSurfaces = shown();
    setVisModule('ridge');
    return { onRidge, onRoom, onSurfaces };
  });
  // A canvas can only ever have one kind of context — one is WebGL's, one is a
  // 2D one, one is Babylon's — so these cannot share an element, and two being
  // visible at once would be two pictures over each other.
  expect(got.onRidge).toEqual({ room: false, ridge: true, room3d: false });
  expect(got.onRoom).toEqual({ room: true, ridge: false, room3d: false });
  expect(got.onSurfaces).toEqual({ room: false, ridge: false, room3d: true });
});

test('the choice of module is remembered', async ({ page }) => {
  await openRidge(page);
  await page.evaluate(() => setVisModule('ridge'));
  await page.reload();
  await page.waitForFunction(() => typeof visModuleKey === 'function');
  expect(await page.evaluate(() => visModuleKey())).toBe('ridge');
});

test('silence is flat, and sound makes peaks in the middle', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(`(() => {
    const r = visRenderer();
    roomEdit.ridge = { source: 'wave', rows: 80 };
    r.configure(ridgeSettings());

    r.clear();
    r.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: ${RDG_CLOCK} });
    for (let i = 0; i < 80; i++) r.push(new Float32Array(0), null);
    const silent = { centre: ${CROSS}(0.5), tail: ${CROSS}(0.12) };

    r.clear();
    ${FEED}(r, 80, 0.9);
    const loud = { centre: ${CROSS}(0.5), tail: ${CROSS}(0.12) };
    return { silent, loud };
  })()`);

  // **Silence is every line flat and every line visible.** No special case does
  // this — the absolute value of nothing is nothing.
  //
  // Eighty *or eighty-one*: the stack slides between pushes and the row leaving
  // at the top is still partly in the margin, so a picture caught mid-slide has
  // a fractional extra line. That is what scrolling looks like, not a fault —
  // and pinning it to exactly eighty would be asserting that the stack does not
  // move, which is the thing that was just fixed.
  expect(got.silent.centre).toBeGreaterThanOrEqual(80);
  expect(got.silent.centre).toBeLessThanOrEqual(81);
  expect(got.silent.tail).toBeGreaterThanOrEqual(80);
  expect(got.silent.tail).toBeLessThanOrEqual(81);

  // Sound raises peaks, and a peak in front hides the lines behind it.
  expect(got.loud.centre, 'sound did not raise peaks in the middle')
    .toBeLessThan(got.silent.centre - 10);
  // And it happens **in the middle**: the tails stay flat, which is what makes
  // this the plot rather than a spectrogram.
  expect(got.loud.tail, 'the tails stopped being flat').toBeGreaterThanOrEqual(80);
});

test('a floor keeps the auto-gain off the noise under a recording', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(`(() => {
    const r = visRenderer();
    const run = (floor, amp, rows) => {
      roomEdit.ridge = { source: 'wave', rows: 80, floor };
      r.configure(ridgeSettings());
      r.clear();
      ${FEED}(r, rows, amp);
      return ${CROSS}(0.5);
    };
    // Far under anything audible — about −66dB — and pushed for long enough that
    // the ceiling has decayed a long way. Four hundred rows is twenty seconds.
    const quiet = { floored: run(0.004, 0.0005, 400), open: run(0, 0.0005, 400) };
    // And the floor must not touch material that is actually there.
    const loud = { floored: run(0.004, 0.9, 80) };
    return { quiet, loud };
  })()`);

  // **The fault.** With no floor the ceiling keeps falling through a quiet
  // passage, the gain keeps climbing to meet it, and what is left to normalise
  // is the noise under the recording — so the picture is at full height over
  // dead air. Peaks hide the lines behind them, so a busy stack counts *fewer*
  // lines than a flat one.
  expect(got.quiet.open, 'the auto-gain did not run away, so this proves nothing')
    .toBeLessThan(70);

  // Floored, the same material is flat: eighty lines, or eighty-one mid-slide.
  expect(got.quiet.floored, 'inaudible material is still being drawn')
    .toBeGreaterThanOrEqual(80);
  expect(got.quiet.floored).toBeLessThanOrEqual(81);

  // And sound still draws, or the floor has simply broken the picture.
  expect(got.loud.floored, 'the floor swallowed audible sound too')
    .toBeLessThan(70);
});

/// The remembered module draws on the way in, without being visited first.
///
/// **The choice was remembered and the canvas was not.** `visRidge` carries
/// `hidden` in the markup, only `visCanvas` takes it off, and `visCanvas` was
/// reachable only through `setVisModule` — which nothing called at startup. So a
/// session that had last used the ridgeline came back to a tick that read the
/// module as `ridge`, found that canvas `display: none`, and returned. Every
/// frame, for ever. The panel stayed black until the room view was opened,
/// because opening it calls `setVisModule`, and that was the only thing that
/// ever revealed the canvas.
///
/// Load a sound and look at it. That is the whole test, and it is the thing that
/// was broken.
test('the remembered module draws on load, without opening the room first', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof setMode === 'function', { timeout: 20_000 });
  // A session that last used the ridgeline, stored the way the app stores it.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('roomData') || '{}');
    d.module = 'ridge';
    localStorage.setItem('roomData', JSON.stringify(d));
  });

  await page.reload();
  await page.waitForFunction(() => typeof setMode === 'function' && typeof rdgAttach === 'function',
    { timeout: 20_000 });
  await page.evaluate(async () => {
    const folder = state.folders[0].name;
    const files = await api(`/api/files?folder=${encodeURIComponent(folder)}`);
    await selectFile(files[0]);
    setMode('edit');
  });
  await page.waitForTimeout(1200);

  const got = await page.evaluate(() => {
    const r = document.getElementById('visRidge');
    const shown = getComputedStyle(r).display !== 'none' && r.clientWidth > 0;
    let ink = null;
    if (shown && r.width) {
      const d = r.getContext('2d').getImageData(0, 0, r.width, r.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 60) lit++;
      ink = (100 * lit / (r.width * r.height));
    }
    return { module: visModuleKey(), shown, ink, attached: Object.keys(visLive) };
  });

  expect(got.module, 'the module was not remembered').toBe('ridge');
  expect(got.shown, 'the chosen module’s canvas is still hidden on load').toBe(true);
  expect(got.attached, 'no renderer was ever attached').toContain('ridge');
  // Silence is a full stack of flat lines, so there is always ink to find.
  expect(got.ink, 'nothing was drawn without opening the room view first')
    .toBeGreaterThan(1);
});

test('the fill is what hides the lines behind', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(`(() => {
    const r = visRenderer();
    const run = (fill) => {
      roomEdit.ridge = { source: 'wave', rows: 80, fill };
      r.configure(ridgeSettings());
      r.clear();
      ${FEED}(r, 80, 0.9);
      return ${CROSS}(0.5);
    };
    return { withFill: run(true), withoutFill: run(false) };
  })()`);

  // **The defining property**, stated as the difference rather than as an
  // absolute. With the fill off nothing is hidden — but the count is still under
  // eighty, because lines drawn over each other merge where they cross, and a
  // peak crossing four lines reads as one. The number that means something is
  // how many *more* lines survive without the fill than with it.
  expect(got.withoutFill - got.withFill,
    `the fill hid nothing: ${got.withoutFill} lines without it, ${got.withFill} with it`)
    .toBeGreaterThan(10);
});

test('a row is fixed when it is born', async ({ page }) => {
  await openRidge(page);
  const same = await page.evaluate(`(() => {
    const r = visRenderer();
    const shot = () => {
      roomEdit.ridge = { source: 'synth', rows: 40 };
      r.configure(ridgeSettings());
      r.clear();
      r.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: ${RDG_CLOCK} });
      for (let i = 0; i < 40; i++) r.push(new Float32Array(0), null);
      visGlTick();
      r.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: ${RDG_CLOCK} });
      const c = document.getElementById('visRidge');
      return c.getContext('2d').getImageData(0, 0, c.width, 200).data.join(',');
    };
    return shot() === shot();
  })()`);
  // Everything random about a row is resolved at push and never revisited, which
  // is what lets the film and the screen be the same picture rather than two
  // evaluations that drift.
  expect(same, 'the same pushes gave a different picture').toBe(true);
});

test('the real pulses are there, and they are the ones Craft measured', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(`(() => {
    const r = visRenderer();
    roomEdit.ridge = { source: 'pulsar', rows: 80 };
    r.configure(ridgeSettings());
    r.clear();
    r.frame({ ridge: ridgeSettings(), ridgePaint: ridgePaint(), clock: ${RDG_CLOCK} });
    for (let i = 0; i < 80; i++) r.push(new Float32Array(0), null);
    return {
      rows: RIDGE_DATA.length,
      points: RIDGE_DATA[0].length,
      tail: ${CROSS}(0.12),
      centre: ${CROSS}(0.5),
    };
  })()`);
  expect(got.rows).toBe(80);
  expect(got.points).toBe(300);
  // Every line visible in the flat tails, and peaks hiding some in the middle.
  expect(got.tail).toBeGreaterThanOrEqual(80);
  expect(got.centre).toBeLessThan(76);
});

test('the palette paints it, and shows its slots and not the room’s', async ({ page }) => {
  await openRidge(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="paint"]');
  const slots = await page.evaluate(() =>
    [...document.querySelectorAll('#roomPaintBody .rp-slot-name')].map((e) => e.textContent));
  // Its own three, then the card's — which belongs to the room rather than to
  // either module, so it is offered under both. What must not appear here is
  // the room's fourteen.
  expect(slots).toEqual(['Line', 'Fill', 'Background', 'Type', 'Type edge', 'Card']);

  const got = await page.evaluate(`(() => {
    const r = visRenderer();
    roomEdit.ridge = { source: 'wave', rows: 40 };
    r.configure(ridgeSettings());
    r.clear();
    ${FEED}(r, 40, 0.9);
    const c = document.getElementById('visRidge');
    const g = c.getContext('2d');
    const count = (want) => {
      visGlTick();
      const d = g.getImageData(0, 0, c.width, Math.min(500, c.height)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - want[0]) < 24 && Math.abs(d[i+1] - want[1]) < 24
            && Math.abs(d[i+2] - want[2]) < 24) n++;
      }
      return n;
    };
    rpSetSlot('ridgeLine', { mode: 'flat', colour: '#ff2200' });
    rpSetSlot('ridgeBackground', { mode: 'flat', colour: '#001133' });
    const painted = { line: count([255, 34, 0]), ground: count([0, 17, 51]) };
    rpSetSlot('ridgeLine', { mode: 'inherit' });
    rpSetSlot('ridgeBackground', { mode: 'inherit' });
    return painted;
  })()`);
  expect(got.line, 'the Line slot did not reach the stroke').toBeGreaterThan(500);
  expect(got.ground, 'the Background slot did not reach the ground').toBeGreaterThan(5000);
});

test('its controls are reachable by a real pointer', async ({ page }) => {
  await openRidge(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="controls"]');
  const bad = await page.evaluate(() => {
    const host = document.getElementById('ridgeEdit');
    const out = [];
    let checked = 0;
    for (const el of host.querySelectorAll('input, select, button')) {
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) { out.push({ el: el.className, why: 'zero size' }); continue; }
      checked++;
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!hit) { out.push({ el: el.className, why: 'off screen' }); continue; }
      if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
        out.push({ el: el.className, why: `covered by ${hit.id || hit.className}` });
      }
      // Inside the panel's box, not merely inside its DOM — that is how `Clear`
      // and `Reset` once ended up drawn over the dock.
      const p = host.getBoundingClientRect();
      if (b.right > p.right + 2 || b.left < p.left - 2) {
        out.push({ el: el.className, why: 'drawn outside the panel' });
      }
    }
    return { checked, out };
  });
  expect(bad.out).toEqual([]);
  expect(bad.checked).toBeGreaterThan(8);
});

// ── the film ──
//
// A module that only works live is half-built. `docs/VIDEO-EXPORT.md` records
// this program shipping that twice — the background colour, and the data block —
// so the export gets its own test rather than an assumption.

test('the export films the module that is chosen', async ({ page }) => {
  await openRidge(page);
  const out = await page.evaluate(async () => {
    if (videoExportSupport()) return { skip: videoExportSupport() };
    const size = { key: 'test', label: 'test', w: 320, h: 180 };

    // What the *encoder* is handed — the ground and the picture composited —
    // not the module's own canvas, which is the thing that cannot disagree
    // with itself.
    const shoot = async (module) => {
      const seen = [];
      const Real = window.VideoFrame;
      window.VideoFrame = class extends Real {
        constructor(src, init) {
          if (seen.length < 1) {
            const c = document.createElement('canvas');
            c.width = size.w; c.height = size.h;
            const g = c.getContext('2d');
            g.drawImage(src, 0, 0);
            seen.push(g.getImageData(0, 0, size.w, size.h).data);
          }
          super(src, init);
        }
      };
      try {
        await videoExport({
          path: state.selectedFile.path,
          from: 0, to: 0, repeats: 0, tail: false,
          size, fps: 30,
          module,
          ridge: { ...ridgeSettings(), source: 'pulsar', rows: 40 },
          // Pure red on near-black. Nothing the room draws is red, so a red
          // pixel in the file came from the ridgeline and from nothing else.
          ridgePaint: { line: '#ff0000', fill: '#000000', background: '#000000' },
          camera: roomCameraDrawn(),
          layers: roomLayers(), occlude: roomOcclude(), order: roomOrder(),
          room: { cold: [0.15, 0.4, 0.9], hot: [0.2, 0.6, 1], core: [0.3, 0.7, 1] },
          background: '#000000',
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
      const d = seen[0];
      let red = 0, blue = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 90 && d[i] > d[i+1] * 2 + 20 && d[i] > d[i+2] * 2 + 20) red++;
        if (d[i+2] > 60 && d[i+2] > d[i] * 2 + 20) blue++;
      }
      return { red, blue };
    };

    return { ridge: await shoot('ridge'), room: await shoot('room') };
  });
  if (out.skip) test.skip(true, out.skip);

  // Filming the ridgeline puts its lines in the file.
  expect(out.ridge.red, 'the ridgeline was not in the film').toBeGreaterThan(200);
  // **And filming the room does not** — which is what says the export is
  // actually reading the choice rather than drawing whatever it always drew.
  expect(out.room.red, 'the room’s film carried the ridgeline’s lines')
    .toBeLessThan(50);
  expect(out.room.blue, 'the room was not in its own film').toBeGreaterThan(100);
});
