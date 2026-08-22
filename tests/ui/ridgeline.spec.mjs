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

/// Count dark→light transitions down one column, at the canvas's own resolution.
///
/// **Not lit area, and not a downscaled copy.** Halving the canvas aliases
/// hairlines into dashes and reports a clean stack as a broken one — the same
/// mistake that read the room's box as absent until it was sampled at native
/// size.
const CROSS = `((xFrac) => {
  // **Draw before reading.** The canvas holds whatever was last painted, and
  // pushing rows does not paint — so a probe that only reads is reading a stale
  // picture. Three tests reported two lines where there were eighty.
  visGlTick();
  const c = document.getElementById('visRidge');
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
});

test('choosing a module shows one canvas and hides the other', async ({ page }) => {
  await openRidge(page);
  const got = await page.evaluate(() => {
    const shown = () => ({
      room: !document.getElementById('visGl').classList.contains('hidden'),
      ridge: !document.getElementById('visRidge').classList.contains('hidden'),
    });
    setVisModule('ridge');
    const onRidge = shown();
    setVisModule('room');
    const onRoom = shown();
    setVisModule('ridge');
    return { onRidge, onRoom };
  });
  // A canvas can only ever have one kind of context, so these cannot share an
  // element and both being visible would be two pictures over each other.
  expect(got.onRidge).toEqual({ room: false, ridge: true });
  expect(got.onRoom).toEqual({ room: true, ridge: false });
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
    for (let i = 0; i < 80; i++) r.push(new Float32Array(0), null);
    const silent = { centre: ${CROSS}(0.5), tail: ${CROSS}(0.12) };

    r.clear();
    ${FEED}(r, 80, 0.9);
    const loud = { centre: ${CROSS}(0.5), tail: ${CROSS}(0.12) };
    return { silent, loud };
  })()`);

  // **Silence is every line flat and every line visible.** No special case does
  // this — the absolute value of nothing is nothing.
  expect(got.silent.centre).toBe(80);
  expect(got.silent.tail).toBe(80);

  // Sound raises peaks, and a peak in front hides the lines behind it.
  expect(got.loud.centre, 'sound did not raise peaks in the middle')
    .toBeLessThan(got.silent.centre - 10);
  // And it happens **in the middle**: the tails stay flat, which is what makes
  // this the plot rather than a spectrogram.
  expect(got.loud.tail, 'the tails stopped being flat').toBe(80);
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
      for (let i = 0; i < 40; i++) r.push(new Float32Array(0), null);
      visGlTick();
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
  expect(got.tail).toBe(80);
  expect(got.centre).toBeLessThan(76);
});

test('the palette paints it, and shows its slots and not the room’s', async ({ page }) => {
  await openRidge(page);
  await page.click('#roomAdmin .rv-tab[data-rvtab="paint"]');
  const slots = await page.evaluate(() =>
    [...document.querySelectorAll('#roomPaintBody .rp-slot-name')].map((e) => e.textContent));
  expect(slots).toEqual(['Line', 'Fill', 'Background']);

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
