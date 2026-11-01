// The four-dimensional solids, and the panel that drives them.
//
// The geometry is checkable against arithmetic that was settled long before
// this program existed: the regular 4-polytopes have known vertex and edge
// counts, and every edge of a regular one is the same length. A construction
// that quietly produces 119 vertices of something that is not a 600-cell still
// draws, and still looks like a knot — which is exactly why it needs a test
// rather than a look.

import { test, expect } from './test.mjs';

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0, {
    timeout: 15_000,
  });
}

/// The Room, on the 4D tab, with the clock stopped so nothing moves under a
/// test that is about to measure it.
async function open4d(page) {
  await ready(page);
  await page.evaluate(() => setMode('room'));
  await page.waitForTimeout(400);
  await page.click('#roomAdmin .rv-tab[data-rvtab="dim4"]');
  await page.evaluate(() => {
    p4.spinning = false;
    for (const pl of Shapes4D.PLANES) p4.angles[pl.key] = 0;
    p4.shape = 'cell8';
    p4.eye = 2.5;
    p4.mode = 'perspective';
    p4BuildPanel();
    p4Draw();
  });
}

test('every solid has the vertex and edge count it is supposed to have', async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(() => {
    const bad = [];
    for (const e of Shapes4D.CATALOGUE) {
      const s = Shapes4D.shape(e.key);
      if (s.verts.length !== e.verts) bad.push(`${e.label}: ${s.verts.length} vertices, wanted ${e.verts}`);
      if (s.edges.length !== e.edges) bad.push(`${e.label}: ${s.edges.length} edges, wanted ${e.edges}`);
      if (s.verts[0].length !== e.dim) bad.push(`${e.label}: ${s.verts[0].length} dimensions, wanted ${e.dim}`);
    }
    return { bad, count: Shapes4D.CATALOGUE.length };
  });
  expect(report.bad, 'solids that were not built correctly').toEqual([]);
  expect(report.count).toBe(8);
});

test('every edge of a regular solid is the same length', async ({ page }) => {
  await ready(page);
  // The check that catches a wrong edge band. Too wide and a solid gains the
  // diagonals of its own faces; too tight and it loses half its wireframe.
  const bad = await page.evaluate(() => {
    const out = [];
    for (const e of Shapes4D.CATALOGUE) {
      const s = Shapes4D.shape(e.key);
      let min = Infinity, max = 0;
      for (const [i, j] of s.edges) {
        let d = 0;
        for (let k = 0; k < s.verts[i].length; k++) d += (s.verts[i][k] - s.verts[j][k]) ** 2;
        d = Math.sqrt(d);
        min = Math.min(min, d); max = Math.max(max, d);
      }
      if ((max - min) / min > 1e-9) out.push(`${e.label}: edges from ${min} to ${max}`);
    }
    return out;
  });
  expect(bad, 'solids whose edges are not all the same length').toEqual([]);
});

test('a rotation in a familiar plane leaves the shadow’s shape alone', async ({ page }) => {
  await ready(page);
  // XY, XZ and YZ are the three that are also rotations in three dimensions.
  // Turning through one of them poses the solid without changing the shape of
  // what it casts — the set of radii cannot move. This is the control for the
  // next test, and it is what makes that one mean something.
  const worst = await page.evaluate(() => {
    const shape = Shapes4D.shape('cell8');
    const radii = (angles) => {
      const m = Shapes4D.model(shape, angles, { eye: 2.5 });
      const r = [];
      for (let i = 0; i < m.verts; i++) {
        r.push(Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]));
      }
      return r.sort((a, b) => a - b);
    };
    const rest = radii({});
    let worst = 0;
    for (const key of ['xy', 'xz', 'yz']) {
      for (const t of [0.3, 0.9, 2.1]) {
        const got = radii({ [key]: t });
        for (let i = 0; i < rest.length; i++) worst = Math.max(worst, Math.abs(rest[i] - got[i]));
      }
    }
    return worst;
  });
  expect(worst, 'a 3D rotation changed the shape of the shadow').toBeLessThan(1e-6);
});

test('a rotation into the fourth dimension does what no 3D rotation can', async ({ page }) => {
  await ready(page);
  // The whole point. Turning a tesseract through ZW swaps its inner and outer
  // cubes, so the shadow changes *shape* rather than pose — and at a quarter
  // turn the exchange is complete and the radii come back to where they began.
  const got = await page.evaluate(() => {
    const shape = Shapes4D.shape('cell8');
    const radii = (angles) => {
      const m = Shapes4D.model(shape, angles, { eye: 2.5 });
      const r = [];
      for (let i = 0; i < m.verts; i++) {
        r.push(Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]));
      }
      return r.sort((a, b) => a - b);
    };
    const spread = (r) => r[r.length - 1] - r[0];
    const rest = radii({});
    return {
      atRest: spread(rest),
      quarterWay: spread(radii({ zw: Math.PI / 4 })),
      // A quarter turn in zw exchanges the two cubes completely.
      quarterTurn: spread(radii({ zw: Math.PI / 2 })),
      edgesHeld: [0, 0.4, 1.2, Math.PI / 2]
        .every((t) => Shapes4D.model(shape, { zw: t }, { eye: 2.5 }).lines === 32),
    };
  });
  // Part way through, the shadow is a different shape from the one it started as.
  expect(Math.abs(got.quarterWay - got.atRest), 'ZW did not change the shadow')
    .toBeGreaterThan(0.05);
  // And at a quarter turn the cubes have swapped, so it matches again.
  expect(Math.abs(got.quarterTurn - got.atRest), 'the cubes did not come back at a quarter turn')
    .toBeLessThan(1e-6);
  expect(got.edgesHeld, 'a solid gained or lost edges while turning').toBe(true);
});

// The simplexes of five, seven and nine dimensions were built in those
// dimensions and then only ever turned in the first four, so their extra axes
// sat still and all three looked alike. Now every axis a shape has can turn.
test('a simplex above four dimensions turns through its extra axes, and a tesseract ignores those keys', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const shadow = (key, angles) => {
      const sh = Shapes4D.shape(key);
      const flat = Shapes4D.project(Shapes4D.rotate(sh.verts, angles), { eye: 2.5 });
      return flat.map((v) => v.map((x) => +x.toFixed(9)));
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      planes: { four: Shapes4D.planesFor(4).length, seven: Shapes4D.planesFor(7).length, nine: Shapes4D.planesFor(9).length },
      keys7: Shapes4D.planesFor(7).map((p) => p.key),
      simplexMoves: !same(shadow('simplex7', {}), shadow('simplex7', { x4: 0.7 })),
      simplexMovesHigh: !same(shadow('simplex9', {}), shadow('simplex9', { z8: 0.5 })),
      tesseractHolds: same(shadow('cell8', {}), shadow('cell8', { x4: 0.7, z8: 0.5 })),
      sixStillWork: !same(shadow('simplex7', {}), shadow('simplex7', { zw: 0.4 })),
      // Turned differently, the three simplexes are three different pictures.
      differ: (() => {
        const a = { x4: 0.7, y4: 0.3, zw: 0.5 };
        const r = (k) => shadow(k, a).map((v) => Math.hypot(...v)).sort((p, q) => p - q);
        const s5 = r('simplex5'), s7 = r('simplex7'), s9 = r('simplex9');
        const spread = (v) => v[v.length - 1] - v[0];
        return [spread(s5), spread(s7), spread(s9)];
      })(),
    };
  });
  expect(got.planes).toEqual({ four: 6, seven: 15, nine: 21 });
  expect(got.keys7).toEqual(expect.arrayContaining(['xy', 'zw', 'x4', 'y4', 'z4', 'x5', 'y6', 'z6']));
  expect(got.simplexMoves, 'the 7-simplex did not turn through its fifth axis').toBe(true);
  expect(got.simplexMovesHigh, 'the 9-simplex did not turn through its ninth axis').toBe(true);
  expect(got.tesseractHolds, 'a plane the tesseract does not have moved it').toBe(true);
  expect(got.sixStillWork).toBe(true);
  expect(new Set(got.differ.map((v) => v.toFixed(3))).size, 'the three simplexes came out the same').toBe(3);
});

// Every control reaches every shape. The grain shapes used to ignore TURN and
// EYE; the sound's turn and the eye now pose a three-dimensional shape too.
test('every shape in both catalogues answers the sound\'s turn and the eye', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const keys = [...Shapes4D.CATALOGUE.map((e) => e.key), ...GRAIN_SHAPES.slice(0, 4).map((m) => m.name)];
    const out = {};
    for (const key of keys) {
      const found = vgSolidShape(key);
      if (!found) { out[key] = null; continue; }
      const { shape, is4d } = found;
      const dim = shape.verts[0].length;
      const rest = vgSolidAngles(dim, 0.3, 0, 0);
      const loud = vgSolidAngles(dim, 0.3, 0.9, 0.3);
      const flat = (ang, eye) => JSON.stringify(vgSolidPose(shape, is4d, ang, eye).flat.map((v) => v.map((x) => +x.toFixed(6))));
      const pose = vgSolidPose(shape, is4d, loud, 2.5);
      out[key] = {
        is4d, dim,
        turns: flat(rest, 2.5) !== flat(loud, 2.5),
        eyeMatters: flat(loud, 1.6) !== flat(loud, 6),
        coloured: pose.turned.every((v) => v.length >= 4 && Number.isFinite(v[3])),
        three: pose.flat.every((v) => v.length === 3),
        edges: shape.edges.length,
      };
    }
    return out;
  });
  for (const [key, r] of Object.entries(got)) {
    expect(r, `${key} is not a shape`).not.toBeNull();
    expect(r.turns, `${key} does not answer the sound's turn`).toBe(true);
    expect(r.eyeMatters, `${key} does not answer the eye`).toBe(true);
    expect(r.coloured, `${key} has no fourth number to colour by`).toBe(true);
    expect(r.three, `${key} did not come out three-dimensional`).toBe(true);
  }
  expect(got.cell8.is4d).toBe(true);
  expect(Object.values(got).every((r) => r.is4d && r.dim === 4 || r.dim > 4), 'a shape is still three-dimensional').toBe(true);
});

// A grain shape is lifted into four dimensions as a prism — two copies joined
// vertex to vertex, the way a cube becomes a tesseract — so a turn through ZW
// swings the copies through each other and it turns inside out too.
test('a grain shape is a four-dimensional prism, and turns inside out through ZW', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    const g = GRAIN_SHAPES[0];
    const { shape, is4d } = vgSolidShape(g.name);
    const radii = (angles) => {
      const flat = Shapes4D.project(Shapes4D.rotate(shape.verts, angles), { eye: 2.5 });
      return flat.map((v) => Math.hypot(...v)).sort((a, b) => a - b);
    };
    const spread = (r) => r[r.length - 1] - r[0];
    const rest = radii({});
    const twins = shape.edges.filter(([a, b]) => Math.abs(a - b) === g.verts).length;
    return {
      name: g.name, is4d, dim: shape.verts[0].length,
      verts: shape.verts.length, wantVerts: 2 * g.verts,
      edges: shape.edges.length, wantEdges: 2 * g.lines + g.verts, twins,
      unit: Math.max(...shape.verts.map((v) => Math.hypot(...v))),
      atRest: spread(rest), quarterWay: spread(radii({ zw: Math.PI / 4 })), halfTurn: spread(radii({ zw: Math.PI })),
    };
  });
  expect(got.is4d).toBe(true);
  expect(got.dim).toBe(4);
  expect(got.verts).toBe(got.wantVerts);
  expect(got.edges).toBe(got.wantEdges);
  expect(got.twins, 'not every vertex is joined to its twin').toBe(got.wantVerts / 2);
  expect(got.unit).toBeCloseTo(1, 6);
  // Part way through ZW the shadow is a different shape; at a half turn the
  // two copies have swapped places and it matches again. (The tesseract
  // matches at a quarter turn as well, being the same in z as in w; a prism
  // over an arbitrary polyhedron is not, so only the half turn is promised.)
  expect(Math.abs(got.quarterWay - got.atRest), `${got.name} did not turn inside out`).toBeGreaterThan(0.02);
  expect(Math.abs(got.halfTurn - got.atRest), 'the copies did not swap back at a half turn').toBeLessThan(1e-6);
});

test('the projection never divides by nothing, however close the eye is put', async ({ page }) => {
  await ready(page);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const e of Shapes4D.CATALOGUE) {
      const s = Shapes4D.shape(e.key);
      // Right up against the solid, and inside where it would be, in every
      // orientation the panel allows.
      for (const eye of [0.0001, 0.5, 1, 1.2, 2.5, 12]) {
        for (const t of [0, 0.7, Math.PI / 2, 3.0]) {
          const m = Shapes4D.model(s, { zw: t, xw: t / 2 }, { eye });
          for (let i = 0; i < m.pos.length; i++) {
            if (!Number.isFinite(m.pos[i])) { out.push(`${e.label} eye=${eye} t=${t}`); break; }
          }
        }
      }
    }
    return out;
  });
  expect(bad, 'a projection produced something that is not a number').toEqual([]);
});

test('a stored shape the catalogue no longer offers falls back rather than blanking', async ({ page }) => {
  await ready(page);
  const got = await page.evaluate(() => {
    localStorage.setItem('audiolab.shape4d.v1', JSON.stringify({
      shape: 'cell1000000', angles: { zw: 'nonsense' }, eye: 'wide', mode: 'sideways',
    }));
    const before = { shape: p4.shape, eye: p4.eye, mode: p4.mode };
    p4Load();
    const after = { shape: p4.shape, eye: p4.eye, mode: p4.mode, zw: p4.angles.zw };
    localStorage.removeItem('audiolab.shape4d.v1');
    return { before, after };
  });
  expect(got.before.shape, 'the panel started on nothing').toBeTruthy();
  expect(got.after.shape, 'an unknown shape was accepted').not.toBe('cell1000000');
  expect(got.after.mode, 'an unknown projection mode was accepted').toBe('perspective');
  expect(typeof got.after.eye).toBe('number');
  expect(Number.isFinite(got.after.zw)).toBe(true);
});

test('the panel lists every solid and shows the six planes', async ({ page }) => {
  await open4d(page);
  const got = await page.evaluate(() => ({
    objects: document.querySelectorAll('#p4Panel .p4-obj').length,
    selected: document.querySelectorAll('#p4Panel .p4-obj.active').length,
    // Six planes, not three axes. There is no axis to name in four dimensions.
    fields: [...document.querySelectorAll('#p4Panel .p4-num-in:not(.p4-knob-read)')].map((i) => i.dataset.p4),
    knobs: [...document.querySelectorAll('#p4Panel input[data-p4k]')].map((i) => i.dataset.p4k),
    // The three that reach into w are marked.
    marked: document.querySelectorAll('#p4Panel .p4-w').length,
    canvas: !!document.querySelector('#p4Canvas')?.width,
  }));
  expect(got.objects).toBe(8);
  expect(got.selected, 'exactly one object should be selected').toBe(1);
  expect(got.fields).toEqual(['XY', 'XZ', 'YZ', 'XW', 'YW', 'ZW']);
  // Eye and Rate are amounts, so they are knobs (design-pass 4D-2).
  expect(got.knobs).toEqual(['Eye', 'Rate']);
  expect(got.marked, 'the three planes reaching into w should be marked').toBe(3);
  expect(got.canvas, 'the preview canvas was never sized').toBe(true);
});

test('dragging sideways on a number changes it, and shift makes it finer', async ({ page }) => {
  await open4d(page);
  const zw = page.locator('#p4Panel .p4-num-in[data-p4="ZW"]');
  const box = await zw.boundingBox();
  const y = box.y + box.height / 2;

  // The interaction a modelling package has and a web form does not. Pressing
  // and moving sideways changes the value.
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 6 });
  await page.mouse.up();
  const coarse = await page.evaluate(() => p4.angles.zw);
  expect(Math.abs(coarse), 'dragging the number did nothing').toBeGreaterThan(0.001);

  await page.evaluate(() => { p4.angles.zw = 0; p4BuildPanel(); });
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const fine = await page.evaluate(() => p4.angles.zw);

  expect(Math.abs(fine), 'shift did not make the drag finer').toBeLessThan(Math.abs(coarse));
  expect(Math.abs(fine), 'shift stopped the drag altogether').toBeGreaterThan(0);
});

test('selecting a different object changes what the attribute manager is about', async ({ page }) => {
  await open4d(page);
  const before = await page.evaluate(() =>
    document.querySelector('#p4Panel .p4-about-name').textContent);

  await page.locator('#p4Panel .p4-obj', { hasText: '600-cell' }).click();
  const after = await page.evaluate(() => ({
    name: document.querySelector('#p4Panel .p4-about-name').textContent,
    counts: document.querySelector('#p4Panel .p4-about-n').textContent,
    shape: p4.shape,
  }));

  expect(before).toContain('tesseract');
  expect(after.name).toContain('600-cell');
  expect(after.counts).toContain('120 vertices');
  expect(after.counts).toContain('720 edges');
  expect(after.shape).toBe('cell600');
});

test('the panel survives a reload with the solid it was left on', async ({ page }) => {
  await open4d(page);
  await page.locator('#p4Panel .p4-obj', { hasText: '24-cell' }).click();
  await page.evaluate(() => { p4.eye = 3.4; p4Save(); });

  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && (state.folders || []).length > 0);
  const got = await page.evaluate(() => ({ shape: p4.shape, eye: p4.eye }));
  expect(got.shape).toBe('cell24');
  expect(got.eye).toBeCloseTo(3.4, 5);

  await page.evaluate(() => { localStorage.removeItem('audiolab.shape4d.v1'); });
});
