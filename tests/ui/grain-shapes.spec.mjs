// The solids the grain cloud draws its grains as.
//
// Two things are worth holding here, and they are different in kind.
//
// The first is that every model is a *solid* — closed, unit, and with as many
// edges as the shape it claims to be. Both of the modelling faults found while
// building these produced a plausible picture: a truncated dodecahedron missing
// three quarters of its edges still looks like a polyhedron, and an octahedron
// spiked on twenty-nine imaginary faces still looks spiky. Neither reads as
// wrong on screen, and Euler's formula catches both instantly. See
// `docs/GRAIN-SHAPES.md`.
//
// The second is that the room actually draws them, which no amount of checking
// the catalogue can tell you.

import { test, expect } from '@playwright/test';

async function openRoom(page) {
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
  await page.evaluate(() => {
    for (const k of ['roomCameras', 'roomLayers', 'roomStreams', 'roomData']) {
      localStorage.removeItem(k);
    }
    roomEdit.cams = {};
    roomEdit.layers = {};
    roomEdit.streams = null;
    roomEdit.frame = 'dock';
    if (!roomEdit.on) toggleRoomEdit();
  });
  await page.waitForTimeout(300);
}

/// Every shape named on the sheets in `Gran Shapes/` is in the catalogue.
test('the catalogue holds every shape off the sheets', async ({ page }) => {
  await page.goto('/');
  const names = await page.evaluate(() => GRAIN_SHAPES.map((s) => s.name));
  for (const want of [
    // The poster of fifteen.
    'tetrahedron', 'square pyramid', 'hexagonal pyramid', 'cube', 'cuboid',
    'triangular prism', 'octahedron', 'pentagonal prism', 'hexagonal prism',
    'dodecahedron', 'sphere', 'ellipsoid', 'icosahedron', 'cone', 'cylinder',
    // What the other sheets add.
    'torus', 'hemisphere', 'pentagonal pyramid', 'frustum',
    // The Archimedean half of the uniform polyhedra sheet.
    'truncated tetrahedron', 'truncated cube', 'truncated octahedron',
    'truncated dodecahedron', 'truncated icosahedron',
    'cuboctahedron', 'icosidodecahedron',
    // Its star half, built as spiked solids.
    'spiked tetrahedron', 'spiked cube', 'spiked octahedron',
    'spiked dodecahedron', 'spiked icosahedron',
    // The simplex projections.
    'simplex 5', 'simplex 7', 'simplex 9',
  ]) {
    expect(names, `\`${want}\` is on a sheet and not in the catalogue`).toContain(want);
  }
});

/// Unit, centred, and no vertex left unjoined.
test('every model is closed and unit', async ({ page }) => {
  await page.goto('/');
  const bad = await page.evaluate(() => {
    const faults = [];
    for (const s of GRAIN_SHAPES) {
      let maxR = 0;
      const touched = new Set();
      for (let v = 0; v < s.verts; v++) {
        maxR = Math.max(maxR, Math.hypot(s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]));
      }
      for (const i of s.idx) touched.add(i);
      // A vertex nothing reaches is a vertex that was built and then lost,
      // which is what a wireframe with a whole edge class missing looks like.
      if (touched.size !== s.verts) {
        faults.push(`${s.name}: ${s.verts - touched.size} of ${s.verts} vertices are unjoined`);
      }
      if (Math.abs(maxR - 1) > 1e-5) faults.push(`${s.name}: reaches ${maxR.toFixed(4)}, not 1`);
      if (s.lines < 3) faults.push(`${s.name}: only ${s.lines} edges`);
      // Nothing here is a hedgehog by accident. The simplexes are fully
      // chorded on purpose; everything else is a surface.
      const cap = s.name.startsWith('simplex') ? s.verts * s.verts : s.verts * 4;
      if (s.lines > cap) faults.push(`${s.name}: ${s.lines} edges over ${s.verts} vertices`);
    }
    return faults;
  });
  expect(bad, bad.join('\n')).toEqual([]);
});

/// The counts the solids are named for.
///
/// This is the check that caught both modelling faults. A truncated icosahedron
/// with thirty edges instead of ninety still draws as a polyhedron and still
/// looks fine in a room; it is only obviously wrong against the number.
test('the polyhedra have the vertices and edges they are named for',
  async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(() => Object.fromEntries(
      GRAIN_SHAPES.map((s) => [s.name, [s.verts, s.lines]])));
    const want = {
      // Platonic.
      tetrahedron: [4, 6], cube: [8, 12], octahedron: [6, 12],
      dodecahedron: [20, 30], icosahedron: [12, 30],
      // Archimedean.
      'truncated tetrahedron': [12, 18], 'truncated cube': [24, 36],
      'truncated octahedron': [24, 36], 'truncated dodecahedron': [60, 90],
      'truncated icosahedron': [60, 90],
      cuboctahedron: [12, 24], icosidodecahedron: [30, 60],
      // A spike on every face: the solid's own count, plus one vertex and as
      // many edges as that face has sides, per face.
      'spiked tetrahedron': [8, 18], 'spiked cube': [14, 36],
      'spiked octahedron': [14, 36], 'spiked dodecahedron': [32, 90],
      'spiked icosahedron': [32, 90],
    };
    for (const [name, [v, e]] of Object.entries(want)) {
      expect(got[name], `${name} came out ${got[name]}, wanted ${[v, e]}`).toEqual([v, e]);
    }
  });

/// Euler's formula, which is what makes the counts above more than a transcript
/// of whatever the code happened to produce.
test('the closed polyhedra satisfy V − E + F = 2', async ({ page }) => {
  await page.goto('/');
  const faults = await page.evaluate(() => {
    // Faces, for a solid whose edges are known: every face is a cycle, and for
    // these solids the count follows from Euler once V and E are trusted. So
    // rather than count faces, check that the face count implied by Euler is a
    // whole number that matches what the solid is made of.
    const faces = {
      tetrahedron: 4, cube: 6, octahedron: 8, dodecahedron: 12, icosahedron: 20,
      'truncated tetrahedron': 8, 'truncated cube': 14, 'truncated octahedron': 14,
      'truncated dodecahedron': 32, 'truncated icosahedron': 32,
      cuboctahedron: 14, icosidodecahedron: 32,
      'spiked tetrahedron': 12, 'spiked cube': 24, 'spiked octahedron': 24,
      'spiked dodecahedron': 60, 'spiked icosahedron': 60,
    };
    const out = [];
    for (const s of GRAIN_SHAPES) {
      const f = faces[s.name];
      if (f === undefined) continue;
      const chi = s.verts - s.lines + f;
      if (chi !== 2) out.push(`${s.name}: V−E+F = ${s.verts}−${s.lines}+${f} = ${chi}`);
    }
    return out;
  });
  expect(faults, faults.join('\n')).toEqual([]);
});

/// A grain's solid is a pure function of the grain, like every other choice
/// made about one.
test('the same grain gets the same solid every time', async ({ page }) => {
  await page.goto('/');
  const same = await page.evaluate(() => {
    for (let h = 0; h < 500; h++) {
      for (let tier = 0; tier < 4; tier++) {
        if (grainShapeFor(h, tier).name !== grainShapeFor(h, tier).name) return false;
      }
    }
    // And a small grain is never handed an intricate one. The tiers nest, so
    // the cheapest one can only ever hold the cheapest shapes.
    for (let h = 0; h < 500; h++) {
      if (grainShapeFor(h, 0).lines > 16) return false;
    }
    return true;
  });
  expect(same, 'a grain was handed a different solid on a second look').toBe(true);
});

/// The tier is the modulus, not a ceiling — which is *why* it has to be settled
/// at birth.
///
/// Stated as a test rather than only as a comment because it is the whole
/// reason the rule exists. If someone ever makes the tiers nest properly, so
/// that a hash names the same solid at every tier, this fails and the rule can
/// be relaxed. Until then, asking for a grain's shape a second time with a
/// different tier is asking for a different grain.
test('a different tier names a different solid', async ({ page }) => {
  await page.goto('/');
  const moved = await page.evaluate(() => {
    let n = 0;
    for (let h = 0; h < 2000; h++) {
      if (new Set([0, 1, 2, 3].map((t) => grainShapeFor(h, t).name)).size > 1) n++;
    }
    return n;
  });
  expect(moved, 'the tiers now nest — see the note on grainShapeFor')
    .toBeGreaterThan(1000);
});

/// A grain keeps its solid all the way to the back wall.
///
/// The one that matters, and the one the checks above cannot make: a grain is
/// dimmer and smaller at the end of its journey than at the start, and for a
/// while the room decided how intricate a solid to draw from exactly those two
/// numbers. Every grain in the air changed shape as it travelled — a pentagonal
/// pyramid left the front of the room and an octahedron reached the wall — and
/// nothing about a still frame looks wrong.
test('a grain keeps its solid for the whole journey', async ({ page }) => {
  await openRoom(page);

  const out = await page.evaluate(async () => {
    for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;

    const sr = 44100, srcFrames = sr * 10;
    const grains = [];
    // A spread of levels, so grains land in every tier there is — the loudest
    // are pinned at the top of the catalogue and would not move even if the
    // fault came back.
    for (let i = 0; i < 60; i++) {
      const f = i / 59;
      grains.push([Math.round(f * sr), Math.round(f * srcFrames),
        Math.round(sr * 0.04), 0, 0.01 + (i % 10) * 0.021, 0.5, 0, i]);
    }
    const paint = (payload) => visGl.frame({
      cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
      cam: roomCamera(), layers: roomLayers(),
      grainRate: sr, srcFrames, positionRate: sr, pollMs: 50, ...payload,
    });

    paint({ grains, position: 0 });
    for (let t = 0.05; t <= 1.0001; t += 0.05) paint({ grains, position: Math.round(sr * t) });
    const born = visGl.grainShapeNames();

    // Now cut the schedule off and let them fly. Whatever is in the room was
    // heard, and it must still be the same thing it was when it was heard.
    //
    // **Watched over seconds, not tenths.** The room is fourteen seconds deep,
    // so a grain a second old has barely left the front of it and is as bright
    // and as near as it was when it was born. The first version of this watched
    // for under a second, which is a window the fault cannot show up in: it
    // stayed green with the fault deliberately put back, twice. Three and a half
    // seconds is a quarter of the journey, and the quiet grains cross two tiers
    // in it.
    const seen = [born];
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 700));
      paint({ grains: null, position: 0 });
      seen.push(visGl.grainShapeNames());
    }
    return { born, seen };
  });

  expect(out.born.length, 'no grains were born, so nothing was watched')
    .toBeGreaterThan(20);
  // The cloud only ever loses grains off the back wall, and it loses them from
  // the front of the list, so every later reading is a tail of the first.
  for (const later of out.seen) {
    const head = out.born.slice(out.born.length - later.length);
    expect(later, `a grain changed shape in mid-air: ${head.join(',')}`
      + ` became ${later.join(',')}`).toEqual(head);
  }
});

/// And the room draws them.
///
/// The catalogue being right says nothing about whether any of it reaches the
/// screen. This walks a playhead through a schedule and looks at the pixels.
test('the room draws grains as solids, not as points', async ({ page }) => {
  await openRoom(page);

  const out = await page.evaluate(async () => {
    const gl = document.getElementById('visGl');
    const ctx = gl.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return null;
    for (const k of ['floor', 'lead', 'sky', 'skin', 'room', 'data']) roomEdit.layers[k] = false;
    roomEdit.layers.grains = true;

    const sr = 44100, srcFrames = sr * 10;
    const grains = [];
    for (let i = 0; i < 120; i++) {
      const f = i / 119;
      grains.push([Math.round(f * sr * 2), Math.round(f * srcFrames),
        Math.round(sr * 0.04), 0, 0.6, 0.5, 0, i]);
    }

    const paint = (payload) => {
      visGl.frame({
        cold: [0.3, 0.6, 0.9], hot: [0.4, 0.8, 0.5], core: [0.5, 0.8, 1],
        cam: roomCamera(), layers: roomLayers(),
        grainRate: sr, srcFrames, positionRate: sr, pollMs: 50,
        ...payload,
      });
      const px = new Uint8Array(gl.width * gl.height * 4);
      ctx.readPixels(0, 0, gl.width, gl.height, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] + px[i + 1] + px[i + 2] > 12) n++;
      }
      return n;
    };

    paint({ grains, position: 0 });
    let lit = 0;
    for (let t = 0.1; t <= 2.0001; t += 0.1) lit = paint({ grains, position: Math.round(sr * t) });
    return { lit, cap: VG_GRAIN_LINE_CAP, shapes: GRAIN_SHAPES.length };
  });

  if (out === null) test.skip(true, 'no readable WebGL context in this harness');

  // A hundred and twenty grains drawn as points would light a few hundred
  // pixels. Drawn as solids they light thousands — that difference is the whole
  // of what this change was.
  expect(out.lit, `the cloud lit ${out.lit} pixels, which is point-sized`)
    .toBeGreaterThan(1500);
  expect(out.shapes, 'the catalogue did not reach the page').toBeGreaterThan(30);
});
